'use client';

import { Button } from '@auto-drive/ui';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useCallback, useEffect, useState } from 'react';
import type { Hash } from 'viem';
import { Check, Loader2 } from 'lucide-react';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import { UsdcWalletStatus } from './UsdcWalletStatus';
import { useNetwork } from '../../../../contexts/network';
import { useTransactionConfirmation } from '../../../../hooks/useTransactionConfirmation';
import { useQuoteClock } from '../../../../hooks/useQuoteClock';
import { useUsdcAvailability } from '../../../../hooks/useUsdcAvailability';
import { ApiError } from '../../../../services/api';
import {
  QUOTE_MIN_REMAINING_MS,
  useUsdcPurchase,
  type UsdcPurchaseStage,
} from '../../../../hooks/useUsdcPurchase';
import { mibToBytes, normaliseMib } from '../../../../utils/credits';
import {
  formatUsdcAmount,
  formatQuoteCountdown,
  quoteRemainingMs,
} from '../../../../utils/usdc';
import {
  clearUsdcResume,
  readUsdcResume,
  saveUsdcResume,
} from '../../../../utils/usdcResume';
import {
  canLeaveUsdcStep,
  evaluateUsdcActions,
} from '../../../../utils/usdcActions';

/** The visible sequence, so a buyer can see what they are being asked for. */
const STEPS: { stage: UsdcPurchaseStage; label: string }[] = [
  { stage: 'quoting', label: 'Lock the price' },
  { stage: 'quoted', label: 'Confirm the amount' },
  { stage: 'switching', label: 'Switch network' },
  { stage: 'approving', label: 'Approve USDC' },
  { stage: 'paying', label: 'Send payment' },
];

const stageIndex = (stage: UsdcPurchaseStage) =>
  stage === 'submitted'
    ? STEPS.length
    : STEPS.findIndex(
        (step) =>
          step.stage ===
          (stage === 'approval-confirming'
            ? 'approving'
            : stage === 'batching' || stage === 'batch-pending'
              ? 'paying'
              : stage === 'checking'
                ? 'switching'
                : stage),
      );

export const UsdcTransferPanel = ({
  onNext,
  onBack,
  context,
}: {
  onNext: (data?: Record<string, unknown>) => void;
  onBack: () => void;
  context: Record<string, unknown>;
}) => {
  const { address, isConnected, chainId: connectedChainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { api } = useNetwork();
  const { target, chain, isAvailable, isLoading, isUnsupported } =
    useUsdcAvailability();

  // Normalised once for the whole panel, for the same reason the AI3 step does
  // it: this step is reachable by deep link, where `context.sizeMB` is whatever
  // the query string carried.
  const sizeMib = normaliseMib(context.sizeMB);
  const requestedBytes = sizeMib === null ? null : mibToBytes(sizeMib);

  // A payment already on chain when this panel was last unmounted.
  //
  // Read once, on mount, before anything else can overwrite it. What it buys is
  // the confirmation screen surviving a reload: the ids below are the only
  // handle the UI has on a purchase the backend is already settling, and losing
  // them leaves a buyer with a debited wallet and a wizard back at step one.
  const [resumed, setResumed] = useState(() => readUsdcResume(sizeMib));

  const {
    stage,
    isBusy,
    intent,
    payTxHash,
    failure,
    message,
    approvalSkipped,
    mayHaveBroadcast,
    batch,
    batchStatusUnavailable,
    quote,
    pay,
    reset,
    acknowledgeNotBroadcast,
  } = useUsdcPurchase({ target, requestedBytes, resumed });

  // A wallet-confirmed batch failure retires the resumed attempt. Its payment
  // chain and intent must not be reused by the next purchase.
  useEffect(() => {
    if (resumed?.batchId && !batch && !payTxHash && failure) setResumed(null);
  }, [resumed, batch, payTxHash, failure]);

  const expiresAt =
    intent?.expiresAt ??
    (resumed?.expiresAt ? new Date(resumed.expiresAt) : null);
  const now = useQuoteClock(expiresAt);
  const countdown = formatQuoteCountdown(expiresAt, now);

  // The live attempt wins; the stored one covers the reload. Both are the same
  // purchase — `readUsdcResume` refuses a record whose size does not match.
  const activeTxHash = (payTxHash ?? resumed?.txHash) as Hash | undefined;
  const activeIntentId = intent?.id ?? resumed?.intentId;

  const {
    isConfirmed,
    currentConfs,
    isFullyConfirmed,
    isPollingBackend,
    isBackendCompleted,
    isOverCap,
    isExpired,
    lockLapsed,
    hasReadIntent,
    waitError,
  } = useTransactionConfirmation({
    txHash: activeTxHash,
    requiredConfirmations: resumed?.confirmations ?? target?.confirmations ?? 6,
    api,
    intentId: activeIntentId,
    // The backend's own number, not a constant here: how long a 410 may persist
    // before the purchase is called lost is a multiple of its credit-granting
    // interval. See UsdcPaymentTarget.settleGraceMs.
    lockLapsedGraceMs: resumed?.settleGraceMs ?? target?.settleGraceMs,
    // Pinned to the payment chain. The moment the payment is submitted the user
    // is free to switch their wallet back to Auto EVM, and unpinned that would
    // stall the confirmation count on a purchase already being credited.
    //
    // The record first, because it is the chain this hash was actually sent on;
    // the target says where a payment would go now. They differ when the target
    // is missing — it is fetched only while USDC is on offer, so a session
    // resumed after the gate closed has none, and would watch the wallet's chain
    // for an Ethereum receipt until it gave up and called a settled payment
    // lost — and, in principle, if a deployment ever moved chains mid-session.
    chainId: resumed?.chainId ?? target?.chainId,
  });

  // Tell the backend which transaction to watch, as soon as there is a hash —
  // NOT after it confirms, which is when the AI3 step does it.
  //
  // The difference is a payment that can be lost. Recording the hash is what
  // keeps `GET /intents/:id` answering 200 through the settlement window rather
  // than 410 the instant `expires_at` passes, and what puts the row under
  // INTENT_TX_GRACE_MINUTES in the expiry sweeper instead of
  // `tx_hash IS NULL AND expires_at < NOW()`. A payment submitted near the end of
  // the ten-minute lock takes six Ethereum confirmations (~72s) to reach the
  // `isConfirmed` this used to wait for, and the buyer should not be shown a
  // lapsed purchase for the whole of it.
  //
  // Best-effort, as before: the watcher subscribes to the receiver's events
  // independently, so a failure here costs the grace window and the head start,
  // not the payment.
  //
  // A 410 here is not a failure to ignore, though. It is the backend saying the
  // lock had already lapsed when this hash arrived — the earliest notice that
  // this purchase needs watching — so it is held in state rather than dropped,
  // instead of leaving the buyer six confirmations of ordinary progress bar
  // (~72s) before `GET /intents/:id` reports the same thing.
  //
  // A caution, though, and NOT a verdict. `isIntentExpired` returns 410 for a
  // PENDING row merely past `expires_at`, while the refusal that actually
  // withholds credits is `markIntentAsConfirmed` finding the settlement window
  // closed — `expires_at` plus `SETTLE_GRACE_MS`, twenty minutes.
  // Six confirmations take ~72s, so this payment is normally credited,
  // and the registration that just failed is not needed for it: the receiver's
  // event subscription finds the intent in the deposit event itself. Cleared by
  // the polling loop's first successful read, for exactly that reason.
  const [registrationLockLapsed, setRegistrationLockLapsed] = useState(false);

  // Written the moment a hash exists, so the window it protects — inclusion plus
  // six confirmations — is covered from its first instant rather than from
  // whenever the next render happened to land.
  useEffect(() => {
    if (!payTxHash || !activeIntentId) return;
    saveUsdcResume({
      intentId: activeIntentId,
      txHash: payTxHash,
      sizeMib,
      // The terms this payment was made under, so a resumed session judges it by
      // those rather than by whatever it can still reach. See UsdcResumeRecord.
      chainId: resumed?.chainId ?? target?.chainId,
      confirmations: resumed?.confirmations ?? target?.confirmations,
      settleGraceMs: resumed?.settleGraceMs ?? target?.settleGraceMs,
    });
  }, [payTxHash, activeIntentId, sizeMib, target, resumed]);

  // Dropped once the purchase has an answer — credited, over cap, or genuinely
  // expired. A record kept past that would re-attach a finished purchase to the
  // next one the buyer starts in this tab.
  //
  // The STORED record only. `resumed` stays in state, because on a resumed
  // session it is the only source of `activeTxHash`, and clearing it the instant
  // the purchase completes would unmount the confirmation block — taking the
  // Continue button with it and offering "Get a price" for credits the buyer has
  // just been granted.
  useEffect(() => {
    if (isBackendCompleted || isOverCap || isExpired) {
      clearUsdcResume();
    }
  }, [isBackendCompleted, isOverCap, isExpired]);

  useEffect(() => {
    if (!payTxHash || !activeIntentId) return;
    void api.watchIntent(activeIntentId, payTxHash).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 410) {
        setRegistrationLockLapsed(true);
      }
      // Anything else is ignored: the UI proceeds regardless and the watcher
      // subscribes to the receiver's events independently.
    });
  }, [api, payTxHash, activeIntentId]);

  // Latched, because `waitError` does not stay put and the exit it opens must.
  //
  // The receipt query holds no data, so react-query clears its error and returns
  // to `pending` on every refetch — and with the client's defaults that is every
  // window refocus, which is exactly what the notice below asks the buyer to do
  // when it tells them to check a block explorer. Unlatched, the exit closes
  // behind them for another round of viem's 180s timeout and three retries.
  //
  // Cleared only by the transaction actually being found, which is the one
  // event that makes watching worth something again.
  const [confirmationStalled, setConfirmationStalled] = useState(false);
  useEffect(() => {
    if (waitError) setConfirmationStalled(true);
    else if (isConfirmed) setConfirmationStalled(false);
  }, [waitError, isConfirmed]);

  // The lock lapsed somewhere and the outcome is still open.
  //
  // Either source counts, and the polling loop resolves both on the same
  // evidence: a 2xx from `GET /intents/:id` is the backend no longer calling the
  // lock lapsed, which withdraws `lockLapsed` and — via `hasReadIntent` — the
  // registration's caution too. Without that second half the amber notice stood
  // through the whole confirmation window of a purchase the backend was plainly
  // still settling, and only `isBackendCompleted` ever cleared it.
  const settlementUncertain =
    ((registrationLockLapsed && !hasReadIntent) || lockLapsed) &&
    !isBackendCompleted &&
    !isOverCap &&
    !isExpired &&
    // Not alongside the stall notice. Both are amber and their advice is
    // opposite — "keep this page open" against "you can go back" — and a
    // payment with no receipt at all is not one that is "still settling".
    !confirmationStalled;

  const wrongChain =
    isConnected && target !== undefined && connectedChainId !== target.chainId;

  // A quote is in hand and nothing has been signed. This is the review gate:
  // the figure below is standing still, and the next click is the one that puts
  // a wallet prompt on screen.
  const awaitingConfirmation = stage === 'quoted' && intent !== null;

  // The gate is a place to sit, so the quote can die while it is being read.
  // `pay()` refuses on the same margin, but discovering that by clicking is a
  // wallet prompt the buyer did not need to see: the button becomes a re-quote
  // instead, on the second the figure stops being payable.
  const remaining = quoteRemainingMs(expiresAt, now);
  const quoteStale =
    awaitingConfirmation &&
    (remaining === null || remaining <= QUOTE_MIN_REMAINING_MS);

  // Quoting obeys the gates; paying a quote already granted does not. The
  // reasoning, and what requiring availability on both used to cost a buyer,
  // is in utils/usdcActions.
  const { canQuote, canPay } = evaluateUsdcActions({
    isConnected,
    isBusy,
    hasSubmittedPayment: Boolean(activeTxHash),
    sizeMib,
    hasTarget: target !== undefined,
    knowsChain: chain !== undefined,
    isAvailable,
    awaitingConfirmation,
    quoteStale,
    mayHaveBroadcast,
  });

  // The way out, and the only one this step has: see canLeaveUsdcStep.
  const canGoBack = canLeaveUsdcStep({
    isBusy,
    // The LIVE hash, not `activeTxHash`. A resumed one is proof the record
    // exists, and counting it made a reload a dead end. See canLeaveUsdcStep.
    hasLivePayment: Boolean(payTxHash),
    hasUnresolvedPayment: Boolean(batch) || failure === 'existing-payment',
    confirmationStalled,
  });

  /**
   * Give up on a payment that is not arriving.
   *
   * Nothing else can retire one. Every `clearUsdcResume` trigger runs behind
   * `isFullyConfirmed`, which a transaction that was never mined never reaches,
   * so the record pins that purchase size for the rest of the tab session: going
   * back only leads to the same dead hash re-attaching on the way in.
   *
   * Offered only once the confirmation has stalled, and deliberately as the
   * buyer's decision rather than something done for them. The risk is real: a
   * transaction written off as lost can still be mined, and is then either
   * credited on its own while they pay again, or — if its lock lapsed first —
   * filed as a mispayment for an admin. Which is why it takes twelve minutes of
   * no receipt and an explicit click, with the hash on screen.
   */
  const discardStalledPayment = useCallback(() => {
    clearUsdcResume();
    setResumed(null);
    // The latches too. Both outlive the hash that set them, and neither has any
    // other way back: `registrationLockLapsed` is withdrawn only by a poll that
    // needs `isFullyConfirmed`, which is exactly what never arrived. Left
    // standing they would label the buyer's NEXT payment stalled from its first
    // second, and file it under a price lock that lapsed on the last one.
    setConfirmationStalled(false);
    setRegistrationLockLapsed(false);
    reset();
  }, [reset]);

  const currentStep = stageIndex(stage);

  return (
    <div className='flex flex-col gap-4'>
      <Section title={`Pay with USDC${chain ? ` on ${chain.name}` : ''}`}>
        <div className='flex flex-col gap-4'>
          {/* Wallet */}
          <div className='flex items-center justify-between rounded-md bg-muted p-4'>
            <div className='flex flex-col'>
              <div className='text-sm font-medium'>Wallet Connection</div>
              <div className='text-xs text-muted-foreground'>
                {isConnected
                  ? wrongChain
                    ? `Connected — will switch to ${chain?.name ?? 'Ethereum'} when you pay`
                    : 'Wallet connected'
                  : 'Please connect your wallet to continue'}
              </div>
            </div>
            {isConnected ? (
              <span className='text-xs font-semibold text-green-700'>
                {address}
              </span>
            ) : (
              <Button onClick={() => openConnectModal?.()}>
                Connect Wallet
              </Button>
            )}
          </div>

          {/* The charge */}
          <div className='flex flex-col gap-3 rounded-md bg-muted p-4'>
            <div className='text-sm font-medium'>Send USDC Transfer</div>
            <InfoRow
              label='Recipient'
              value={<span>{target?.receiverAddress ?? '—'}</span>}
            />
            <InfoRow
              label='Network'
              value={<span>{chain?.name ?? '—'}</span>}
            />
            <InfoRow
              label='Amount'
              value={
                <span className='font-semibold'>
                  {/* The locked quote, exact to the base unit — this is what the
                      wallet will be asked to move. Before a quote exists there
                      is no amount to show, and an estimate in its place would be
                      a number nobody is charged. */}
                  {intent?.quotedTokenAmount != null
                    ? `${formatUsdcAmount(
                        intent.quotedTokenAmount,
                        target?.tokenDecimals,
                      )} USDC`
                    : // A resumed session has the hash but not the quote — the
                      // amount lived in the state a reload destroyed. "Quoted
                      // when you continue" would be a lie next to a payment
                      // already on chain.
                      activeTxHash
                      ? '—'
                      : 'Quoted when you continue'}
                </span>
              }
            />
            {countdown && (
              <InfoRow
                label='Price locked for'
                value={
                  <span
                    className={
                      countdown === '0:00' ? 'text-red-600' : undefined
                    }
                  >
                    {countdown}
                  </span>
                }
              />
            )}

            {/* Progress through the two signatures */}
            {(isBusy ||
              awaitingConfirmation ||
              stage === 'submitted' ||
              batch) && (
              <ol className='flex flex-col gap-1 text-xs'>
                {STEPS.map((step, index) => {
                  const batching =
                    stage === 'batching' || stage === 'batch-pending';
                  if (batching && step.stage === 'approving') return null;
                  const done =
                    index < currentStep ||
                    (step.stage === 'approving' && approvalSkipped);
                  const active = index === currentStep;
                  return (
                    <li
                      key={step.stage}
                      className={`flex items-center gap-2 ${
                        active
                          ? 'font-medium'
                          : done
                            ? 'text-muted-foreground'
                            : 'text-muted-foreground/60'
                      }`}
                    >
                      {done ? (
                        <Check className='h-3.5 w-3.5 text-green-600' />
                      ) : active && isBusy ? (
                        <Loader2 className='h-3.5 w-3.5 animate-spin' />
                      ) : active ? (
                        // The review step waits on the BUYER, not on us. A
                        // spinner there says "working", which is the one thing
                        // nothing is doing.
                        <span className='h-3.5 w-3.5 text-center leading-none'>
                          →
                        </span>
                      ) : (
                        <span className='h-3.5 w-3.5' />
                      )}
                      {batching && step.stage === 'paying'
                        ? 'Approve and pay USDC'
                        : step.label}
                      {step.stage === 'approving' && approvalSkipped && (
                        <span className='text-muted-foreground'>
                          (already approved)
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            <div className='flex gap-3'>
              {/* Locked once the purchase is under way, and permanently once a
                  payment exists.

                  Leaving this step UNMOUNTS the panel — the wizard renders only
                  the current step — and every id this hook holds is local
                  state, so the intent and the transaction hash go with it. An
                  in-flight `pay` is not cancelled by that: the wallet prompt
                  is a separate window, the page behind it stays clickable, and
                  the signature still broadcasts. It just arrives with nowhere
                  to record it, so `watchIntent` never runs and the intent keeps
                  no hash.

                  Coming back mounts a fresh hook with no intent, which quotes
                  again and charges a second time for the same purchase. Still
                  offered while a quote merely sits unpaid — nothing is owed on
                  an intent nobody transfers to, and it expires on its own. The
                  AI3
                  panel avoids all of this by rendering no Back button at all
                  (`void onBack`); this one needs the affordance before the
                  money moves and must not keep it afterwards.

                  With one exception, which is `canLeaveUsdcStep`: a payment
                  whose confirmation has stalled outright. Watching it is no
                  longer worth the dead end that closing every exit creates, and
                  the stored record means leaving does not lose the hash. */}
              <Button variant='outline' onClick={onBack} disabled={!canGoBack}>
                Back
              </Button>
              {/* Two clicks, not one, and the gap between them is the point: a
                  buyer sees the exact figure and its countdown standing still
                  before any wallet prompt appears. Quoting is free — an intent
                  nobody pays expires on its own — so the first click commits to
                  nothing. */}
              {awaitingConfirmation && !quoteStale ? (
                <Button onClick={() => void pay()} disabled={!canPay}>
                  {intent?.quotedTokenAmount != null
                    ? `Pay ${formatUsdcAmount(
                        intent.quotedTokenAmount,
                        target?.tokenDecimals,
                      )} USDC`
                    : 'Pay'}
                </Button>
              ) : (
                <Button onClick={() => void quote()} disabled={!canQuote}>
                  {isBusy
                    ? 'Working…'
                    : batch
                      ? 'Processing payment…'
                      : activeTxHash
                        ? 'Sent'
                        : quoteStale
                          ? 'Get a fresh price'
                          : 'Get a price'}
                </Button>
              )}
            </div>

            {awaitingConfirmation && !quoteStale && (
              <div className='text-xs text-muted-foreground'>
                Nothing has been sent yet. Paying asks your wallet to approve
                this exact amount and then transfer it
                {chain ? ` on ${chain.name}` : ''}.
              </div>
            )}

            {quoteStale && !mayHaveBroadcast && (
              <div className='text-xs text-amber-700 dark:text-amber-300'>
                This quote has too little time left to start payment safely. Get
                a fresh quote to continue.
              </div>
            )}

            {sizeMib === null && (
              <div className='text-xs text-red-600'>
                This link does not carry a valid purchase size. Start again from
                package selection to choose one.
              </div>
            )}

            {/* USDC closed while the user was here, or this build cannot reach
                the chain the deployment named. The two read differently on
                purpose: one clears on its own and is worth waiting out, the
                other is a deployment/build mismatch that never will and is
                worth reporting. The gate that closed stays on the admin
                dashboard either way; what a buyer needs is the alternative. */}
            {!isLoading && !isAvailable && (
              <div className='rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'>
                {isUnsupported
                  ? 'This version of the app cannot pay USDC on the network this deployment uses — you can pay with AI3.'
                  : canPay
                    ? // The gate shut on NEW purchases while this buyer holds a
                      // quote that is still good. Nothing on the settlement path
                      // consults it, so this payment is credited exactly as it
                      // would have been a minute ago — and "pay in AI3 instead"
                      // would be advice to abandon a live price lock for no
                      // reason.
                      'USDC has just closed for new purchases, but the price ' +
                      'you locked is still payable — you can send it now.'
                    : 'USDC payments are temporarily unavailable — you can pay with AI3.'}{' '}
                {/* Offered exactly where Back is, which is the point: a gate can
                    close after a payment is on chain, and that payment still
                    settles, so this must not invite a buyer away from a screen
                    that is counting it. `canGoBack` also hides it mid-wallet-
                    prompt, which the old `!activeTxHash` gate did not. A live
                    quote is kept for its own reason: leaving discards a lock the
                    buyer can still spend. */}
                {canGoBack && !canPay && (
                  <button type='button' className='underline' onClick={onBack}>
                    Go back to change the payment method.
                  </button>
                )}
              </div>
            )}

            <UsdcWalletStatus
              stage={stage}
              quoteExpired={remaining === 0}
              isBusy={isBusy}
              mayHaveBroadcast={mayHaveBroadcast}
              hasTxHash={Boolean(activeTxHash)}
              hasBatch={Boolean(batch)}
              hasKnownPayment={failure === 'existing-payment'}
              batchStatusUnavailable={batchStatusUnavailable}
              batchWalletConnected={
                isConnected &&
                address?.toLowerCase() === batch?.payer?.toLowerCase()
              }
              onAcknowledge={acknowledgeNotBroadcast}
            />

            {failure && message && !mayHaveBroadcast && (
              <div
                className={`rounded-md p-3 text-sm ${
                  // A declined wallet prompt and a closed gate are not errors —
                  // one is a choice and the other is a temporary state — so
                  // neither gets the red treatment a real failure does.
                  failure === 'unavailable' ||
                  failure === 'rejected' ||
                  failure === 'quote-expired'
                    ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                    : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                }`}
              >
                {message}
                {failure === 'quote-expired' && (
                  <div className='mt-2'>
                    <Button
                      onClick={() => {
                        reset();
                        void quote();
                      }}
                    >
                      Get a fresh quote
                    </Button>
                  </div>
                )}
                {failure === 'unavailable' && (
                  <div className='mt-2'>
                    <button
                      type='button'
                      className='underline'
                      onClick={onBack}
                    >
                      Pay with AI3 instead
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Confirmation — the same shape as the AI3 step, so the two flows
              end identically. */}
          {activeTxHash && (
            <div className='flex flex-col gap-3 rounded-md bg-muted p-4'>
              <div className='text-sm font-medium'>Confirmation</div>
              <InfoRow
                label='Transaction Hash'
                value={<span>{activeTxHash}</span>}
              />
              <div className='text-xs text-muted-foreground'>
                {/* On `isConfirmed`, not on `!isWaitingReceipt`: the loading
                    flag is false in the error state too, so a receipt that
                    never arrived printed "Included" directly above the notice
                    saying it had not. */}
                {isConfirmed
                  ? 'Included'
                  : confirmationStalled
                    ? 'Not found on chain'
                    : 'Waiting for transaction to be included…'}
              </div>
              {isConfirmed && (
                <>
                  <div className='text-xs text-muted-foreground'>
                    {currentConfs}/{target?.confirmations ?? 6} confirmations
                  </div>
                  <div className='mt-1 w-full'>
                    <div className='h-2 w-full rounded bg-muted-foreground/20'>
                      <div
                        className='h-2 rounded bg-green-600'
                        style={{
                          width: `${Math.min(
                            100,
                            Math.floor(
                              (currentConfs / (target?.confirmations ?? 6)) *
                                100,
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </>
              )}
              {isFullyConfirmed && !isOverCap && !isExpired && (
                <div className='text-xs text-muted-foreground'>
                  {isPollingBackend
                    ? 'Waiting for backend to update credits…'
                    : ''}
                </div>
              )}
              {isOverCap && (
                <div className='rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300'>
                  <strong>Credit cap reached.</strong> Your account has reached
                  its maximum credit limit. Your payment was received but
                  credits could not be applied. Please contact support for
                  assistance.
                </div>
              )}
              {settlementUncertain && (
                <div className='rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'>
                  <strong>
                    Price lock lapsed; payment still being checked.
                  </strong>{' '}
                  The quote has expired. A payment already sent may still be
                  credited during settlement. Do not send another payment. Keep
                  this page open and contact support with the transaction hash
                  above if your credits do not arrive.
                </div>
              )}
              {isExpired && (
                <div className='rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300'>
                  <strong>Payment expired.</strong> The payment window for this
                  transaction has closed and credits will not be applied. Please
                  contact support for assistance, quoting the transaction hash
                  above.
                </div>
              )}
              {/* viem's own message named a timeout and a retry count, which
                  tells a buyer nothing they can act on. What they need is what
                  is known — no receipt, the hash is still theirs — and the one
                  decision only they can make. */}
              {confirmationStalled && (
                <div className='rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'>
                  <strong>Still not confirmed.</strong> We could not reach a
                  receipt for this transaction. It may still be pending — check
                  the hash above in your wallet or on a block explorer, and keep
                  it for support either way.
                  <div className='mt-2'>
                    <Button variant='outline' onClick={discardStalledPayment}>
                      Discard and start over
                    </Button>
                  </div>
                  <div className='mt-1 text-xs'>
                    Only if your wallet shows it failed. One that lands later is
                    normally still credited — so paying again would buy the
                    credits twice — and if its price lock has lapsed by then, it
                    needs support either way.
                  </div>
                </div>
              )}
              <div className='flex gap-3'>
                <Button
                  onClick={() =>
                    onNext({ txHash: activeTxHash, sizeMB: sizeMib })
                  }
                  disabled={
                    !isFullyConfirmed ||
                    !isBackendCompleted ||
                    isOverCap ||
                    isExpired
                  }
                >
                  {isFullyConfirmed &&
                  !isBackendCompleted &&
                  !isOverCap &&
                  !isExpired
                    ? 'Finalizing…'
                    : 'Continue'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
};
