'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAccount,
  useConfig,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { getCapabilities, getCallsStatus, sendCalls } from 'wagmi/actions';
import { erc20ApprovalAbi, usdcReceiverAbi } from '@auto-drive/ui';
import { IntentStatus, UsdcPaymentTarget } from '@auto-drive/models';
import { Address, BaseError, encodeFunctionData, Hash } from 'viem';
import { ApiError, CreatedIntent } from '../services/api';
import { usePaymentIntent } from './usePaymentIntent';
import {
  clearUsdcResume,
  saveUsdcResume,
  type UsdcResumeRecord,
} from '../utils/usdcResume';
import {
  isBatchUnsupported,
  isWalletRejection,
  wasNotSubmitted,
} from '../utils/usdcWalletErrors';

/**
 * How far a USDC purchase has got. Rendered as a checklist, so the buyer can see
 * whether their wallet is approving, paying, or confirming a combined request.
 */
export type UsdcPurchaseStage =
  | 'idle'
  /** Asking the backend for a price. */
  | 'quoting'
  /** A live quote is in hand and nothing has been signed. The review gate. */
  | 'quoted'
  | 'checking'
  | 'switching'
  | 'approving'
  | 'approval-confirming'
  | 'batching'
  | 'batch-pending'
  | 'paying'
  | 'submitted';

/**
 * A failure the buyer can act on, separated from its message so the UI can
 * decide what to offer rather than parsing prose.
 */
export type UsdcPurchaseFailure =
  /** The gates closed between the selection and the quote. Offer AI3. */
  | 'unavailable'
  /** The price lock lapsed before the payment went out. Offer a fresh quote. */
  | 'quote-expired'
  /** Not enough USDC in the wallet on the payment chain. */
  | 'insufficient-balance'
  /** The user declined in their wallet — the network switch or a signature. */
  | 'rejected'
  /** The server reports a payment, but has no hash we can track yet. */
  | 'existing-payment'
  /** Something else went wrong. Offer a retry. */
  | 'failed';

/**
 * Leave time to confirm and mine the payment. Backend settlement grace protects
 * submitted payments; it is not extra time for checkout to start new requests.
 * This check cannot revoke a request that is already open in the wallet.
 */
export const QUOTE_MIN_REMAINING_MS = 45_000;

const EXISTING_PAYMENT_MESSAGE =
  'The server has already recorded a payment for this purchase. Do not pay again. Check your credits or contact support if they have not arrived.';

/**
 * The USDC leg of a credit purchase, in two acts: **quote**, then **pay**.
 *
 * Split deliberately. A buyer must see the exact figure they are about to
 * transfer, and see it standing still, before a wallet asks them for anything —
 * a single click that quotes and signs shows the number and the prompt at the
 * same instant, which is not a review. So `quote()` stops at `quoted`, and
 * `pay()` is a second, separate decision.
 *
 * Kept out of the step component because it is a state machine rather than a
 * render, and because two of its properties are only true if it is written in
 * one place:
 *
 *   - **One intent per attempt.** Paying REUSES the intent already in hand while
 *     the lock holds. Creating a second would re-quote at a new rate and strand
 *     the first, whose approval the user has already given — and the backend
 *     would file the eventual payment against whichever id the client last
 *     remembered.
 *   - **No new payment request for an expired quote.** Revalidate immediately
 *     before opening the wallet, including after approval. An already-open
 *     request cannot be revoked by this hook: the receiver has no deadline.
 *     Keep tracking any returned hash even if the buyer confirms it late.
 *
 * The approval survives an expired quote on purpose (an ERC20 allowance is not
 * tied to an intent), so the fresh attempt skips straight to paying when the new
 * quote is no larger.
 */
export const useUsdcPurchase = ({
  target,
  requestedBytes,
  resumed,
}: {
  target: UsdcPaymentTarget | undefined;
  requestedBytes: bigint | null;
  resumed?: UsdcResumeRecord | null;
}) => {
  const { address, connector, chainId: connectedChainId } = useAccount();
  const config = useConfig();
  const queryClient = useQueryClient();
  const { usdcPaymentIntent, getPaymentIntent } = usePaymentIntent();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  // Pinned to the payment chain, not the connected one: every read below is
  // about Ethereum, and a wallet on Auto EVM must not make an allowance read
  // resolve against the wrong chain's state.
  const publicClient = usePublicClient({ chainId: target?.chainId });

  const [batch, setBatch] = useState<UsdcResumeRecord | null>(() =>
    resumed?.batchId && !resumed.txHash ? resumed : null,
  );
  const [batchStatusUnavailable, setBatchStatusUnavailable] = useState(false);
  const [stage, setStage] = useState<UsdcPurchaseStage>(
    batch ? 'batch-pending' : 'idle',
  );
  const [intent, setIntent] = useState<CreatedIntent | null>(null);
  const [payTxHash, setPayTxHash] = useState<Hash | undefined>(undefined);
  const [isPaymentCompleted, setIsPaymentCompleted] = useState(false);
  const knownPaymentWithoutHash = useRef(
    Boolean(resumed?.paymentKnown && !resumed.txHash),
  );
  const [failure, setFailure] = useState<UsdcPurchaseFailure | null>(
    knownPaymentWithoutHash.current ? 'existing-payment' : null,
  );
  const [message, setMessage] = useState<string | null>(
    knownPaymentWithoutHash.current ? EXISTING_PAYMENT_MESSAGE : null,
  );
  // Surfaced so the checklist can say "already approved" instead of silently
  // skipping a step the user was told to expect.
  const [approvalSkipped, setApprovalSkipped] = useState(false);
  // A submitted request can lose its response. Until it is explicitly refused
  // or resolved, retrying could pay the same intent twice. This flag is a
  // submission guard, not a UI error: it is also true while the wallet is open.
  const [mayHaveBroadcast, setMayHaveBroadcast] = useState(
    Boolean(batch || knownPaymentWithoutHash.current),
  );
  // Unlike rendered button state, this also blocks stale callbacks and retries
  // before React has had a chance to render a submitted payment.
  const paymentSubmitted = useRef(
    Boolean(batch || resumed?.txHash || knownPaymentWithoutHash.current),
  );
  // Synchronous guards cover double-clicks before React renders the busy state.
  const payInFlight = useRef(false);

  const isBusy =
    stage !== 'idle' &&
    stage !== 'quoted' &&
    stage !== 'submitted' &&
    stage !== 'batch-pending';

  /** Is the quote still worth paying? See QUOTE_MIN_REMAINING_MS. */
  const isQuoteLive = useCallback(
    (candidate: CreatedIntent | null): candidate is CreatedIntent =>
      candidate !== null &&
      candidate.quotedTokenAmount !== null &&
      candidate.expiresAt !== null &&
      candidate.expiresAt.getTime() - Date.now() > QUOTE_MIN_REMAINING_MS,
    [],
  );

  const fail = useCallback(
    (reason: UsdcPurchaseFailure, text: string, next: UsdcPurchaseStage) => {
      setFailure(reason);
      setMessage(text);
      setStage(next);
    },
    [],
  );

  // The browser clock is for display and early rejection. Re-read the server
  // before opening a wallet request so a stale tab or slow device clock cannot
  // initiate a payment that the server already considers expired.
  const validateQuote = useCallback(
    async (quoted: CreatedIntent) => {
      try {
        const current = await getPaymentIntent(quoted.id);
        if (current.status === IntentStatus.EXPIRED && !current.txHash) {
          throw new ApiError(410, 'The price lock expired.');
        }
        if (current.status !== IntentStatus.PENDING || current.txHash) {
          // Server evidence of a payment is not a retryable validation error.
          // Adopt the hash before checking expiry: the quote can expire while
          // an existing payment settles, but that must never offer a new charge.
          paymentSubmitted.current = true;
          setMayHaveBroadcast(true);
          knownPaymentWithoutHash.current = !current.txHash;
          saveUsdcResume({
            intentId: quoted.id,
            txHash: current.txHash,
            paymentKnown: !current.txHash,
            sizeMib:
              requestedBytes === null
                ? null
                : Number(requestedBytes) / 1_048_576,
            chainId: target?.chainId,
            confirmations: target?.confirmations,
            settleGraceMs: target?.settleGraceMs,
          });
          if (current.txHash) {
            setPayTxHash(current.txHash as Hash);
            setStage('submitted');
          } else {
            fail('existing-payment', EXISTING_PAYMENT_MESSAGE, 'quoted');
          }
          return false;
        }
        const deadline = current.expiresAt
          ? new Date(current.expiresAt).getTime()
          : NaN;
        if (
          !isQuoteLive(quoted) ||
          !Number.isFinite(deadline) ||
          deadline - Date.now() <= QUOTE_MIN_REMAINING_MS
        ) {
          throw new ApiError(410, 'The price lock expired.');
        }
        return true;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 410) throw error;
        setIntent(null);
        fail(
          'quote-expired',
          'The price lock expired. Get a fresh quote before confirming payment.',
          'idle',
        );
        return false;
      }
    },
    [fail, getPaymentIntent, isQuoteLive, requestedBytes, target],
  );

  const reset = useCallback(() => {
    if (
      payInFlight.current ||
      batch ||
      knownPaymentWithoutHash.current ||
      (mayHaveBroadcast && !payTxHash)
    )
      return;
    paymentSubmitted.current = false;
    setStage('idle');
    setIntent(null);
    setPayTxHash(undefined);
    setFailure(null);
    setMessage(null);
    setApprovalSkipped(false);
    setMayHaveBroadcast(false);
  }, [batch, mayHaveBroadcast, payTxHash]);

  /**
   * "I checked my wallet — nothing was sent."
   *
   * Only the buyer can close this. The client cannot tell a transaction that was
   * never broadcast from one whose answer it simply lost; the wallet in front of
   * them can.
   */
  const acknowledgeNotBroadcast = useCallback(() => {
    if (
      payInFlight.current ||
      batch ||
      payTxHash ||
      knownPaymentWithoutHash.current
    )
      return;
    paymentSubmitted.current = false;
    setMayHaveBroadcast(false);
    setFailure(null);
    setMessage(null);
  }, [batch, payTxHash]);

  // A server-recorded payment can acquire its hash or finish after our first
  // read. Reconcile it even after reload, without ever enabling another charge.
  const knownIntentId = intent?.id ?? resumed?.intentId;
  useEffect(() => {
    if (failure !== 'existing-payment' || !knownIntentId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const current = await getPaymentIntent(knownIntentId);
        if (stopped) return;
        if (current.status === IntentStatus.COMPLETED) {
          clearUsdcResume();
          setIsPaymentCompleted(true);
          setFailure(null);
          setMessage(null);
          setStage('submitted');
          void queryClient.invalidateQueries({ queryKey: ['account'] });
          void queryClient.invalidateQueries({ queryKey: ['creditSummary'] });
          return;
        }
        if (current.txHash) {
          saveUsdcResume({
            intentId: knownIntentId,
            txHash: current.txHash,
            sizeMib:
              requestedBytes === null
                ? null
                : Number(requestedBytes) / 1_048_576,
            chainId: resumed?.chainId ?? target?.chainId,
            confirmations: resumed?.confirmations ?? target?.confirmations,
            settleGraceMs: resumed?.settleGraceMs ?? target?.settleGraceMs,
          });
          knownPaymentWithoutHash.current = false;
          setPayTxHash(current.txHash as Hash);
          setFailure(null);
          setMessage(null);
          setStage('submitted');
          return;
        }
      } catch {
        // A failed read, including an expired quote, cannot prove no payment
        // was sent. Retain the record and retry without unlocking payment.
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    failure,
    knownIntentId,
    getPaymentIntent,
    requestedBytes,
    resumed,
    target,
    queryClient,
  ]);

  // A batch ID is not a transaction hash. Keep polling it, including after a
  // reload or a lost sendCalls response, until the wallet supplies receipts.
  // Status errors never authorize another payment. 400/500 explicitly mean
  // none of the calls took effect; 600 (partial execution) does NOT.
  useEffect(() => {
    if (
      !batch?.batchId ||
      !connector ||
      address?.toLowerCase() !== batch.payer?.toLowerCase()
    )
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await getCallsStatus(config, {
          id: batch.batchId!,
          connector,
        });
        if (stopped) return;
        if (result.chainId !== batch.chainId)
          throw new Error('Wrong batch chain');
        if (result.statusCode === 400 || result.statusCode === 500) {
          clearUsdcResume();
          setBatch(null);
          paymentSubmitted.current = false;
          setMayHaveBroadcast(false);
          fail(
            'failed',
            'The wallet could not complete the payment. No USDC was sent. Please try again.',
            intent ? 'quoted' : 'idle',
          );
          return;
        }
        const receipts = result.receipts ?? [];
        if (
          result.status === 'success' &&
          result.atomic &&
          receipts.length > 0 &&
          receipts.every((receipt) => receipt.status === 'success')
        ) {
          const hash = receipts[receipts.length - 1].transactionHash;
          saveUsdcResume({ ...batch, batchId: undefined, txHash: hash });
          setPayTxHash(hash);
          setBatch(null);
          setFailure(null);
          setMessage(null);
          setStage('submitted');
          return;
        }
        setBatchStatusUnavailable(result.status !== 'pending');
      } catch {
        if (!stopped) setBatchStatusUnavailable(true);
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [address, batch, config, connector, fail, intent]);

  /**
   * Translate a thrown value into a failure the panel can offer a choice for.
   *
   * `next` is the stage to fall back to: whatever was in hand before the attempt
   * that failed. A rejected signature must not throw away a live quote — the
   * buyer's next click should be Pay, not Get a price all over again.
   */
  const handleThrown = useCallback(
    (error: unknown, next: UsdcPurchaseStage) => {
      // The gates closing between the selection and the quote is the one failure
      // with a different answer — offer AI3 rather than a retry — and it arrives
      // as a code precisely so this does not depend on the wording.
      if (
        error instanceof ApiError &&
        (error.code === 'USDC_PAYMENTS_UNAVAILABLE' ||
          error.code === 'USDC_PAYMENTS_DISABLED')
      ) {
        fail('unavailable', error.message, next);
        return;
      }

      // Declining in the wallet is not an error, and it is the most common way
      // out of this flow — the network switch and both signatures can each be
      // refused. viem's own message for it is a multi-paragraph dump with the
      // request details and a docs link, which reads like a crash for something
      // the user chose to do.
      if (isWalletRejection(error)) {
        fail(
          'rejected',
          'The request was declined in your wallet. Nothing was sent — you can ' +
            'try again.',
          next,
        );
        return;
      }

      fail(
        'failed',
        error instanceof BaseError
          ? error.shortMessage
          : error instanceof Error
            ? error.message
            : 'The payment could not be sent.',
        next,
      );
    },
    [fail],
  );

  /**
   * Act one: get a price and stop.
   *
   * Nothing is signed here and nothing is owed — an intent that is never paid
   * expires on its own — so this is safe to run the moment the buyer asks to
   * see the figure.
   */
  const quote = useCallback(async () => {
    if (payInFlight.current || paymentSubmitted.current) return;
    if (!target || requestedBytes === null) return;

    setFailure(null);
    setMessage(null);
    setApprovalSkipped(false);
    setStage('quoting');

    try {
      const quoted = await usdcPaymentIntent(requestedBytes);
      setIntent(quoted);

      // A quote that is already too old to pay the moment it arrives means the
      // two clocks disagree, since the backend locks it for ten minutes from
      // its own `now`. Reported as such rather than as "the price expired",
      // which would offer a fresh quote — and every fresh quote would arrive
      // equally dead, creating an intent per click for as long as the user
      // kept trying.
      if (!isQuoteLive(quoted)) {
        setIntent(null);
        fail(
          'failed',
          'The quoted price arrived already expired, which usually means the ' +
            'clock on this device is out of sync. Check your date and time ' +
            'settings, or pay in AI3.',
          'idle',
        );
        return;
      }

      setStage('quoted');
    } catch (error) {
      handleThrown(error, 'idle');
    }
  }, [
    fail,
    handleThrown,
    isQuoteLive,
    requestedBytes,
    target,
    usdcPaymentIntent,
  ]);

  /**
   * Act two: switch, approve, pay — on the quote the buyer just reviewed.
   *
   * Never re-quotes. A lapsed lock ends here with `quote-expired` and sends the
   * buyer back through `quote()`, so the figure they confirm is always the
   * figure they were shown.
   */
  const runPay = useCallback(async () => {
    if (!target || !address || !publicClient) return;
    if (intent === null) return;

    setFailure(null);
    setMessage(null);
    setApprovalSkipped(false);

    const quoted = intent;
    const amount = quoted.quotedTokenAmount;
    if (amount === null) {
      // A USDC intent without a quote is a backend that changed shape under us.
      // Better to stop than to guess an amount to charge.
      fail(
        'failed',
        'This purchase came back without a USDC amount. Please try again.',
        'idle',
      );
      return;
    }

    // Before anything, not only before the payment write. The review gate is a
    // place a buyer can sit — that is what it is for — so the quote they are
    // looking at may have died while they read it. Without this they are walked
    // through a chain switch and possibly an approval signature first, and told
    // the price expired only at the end.
    //
    // The check below, immediately before the payment, still stands: it catches
    // a lock that lapses DURING those steps, which the approval can easily
    // outlast.
    if (!isQuoteLive(quoted)) {
      setIntent(null);
      fail(
        'quote-expired',
        'The quoted price expired before you confirmed it. Get a fresh quote ' +
          'to continue — nothing was sent.',
        'idle',
      );
      return;
    }

    const receiver = target.receiverAddress as Address;
    const token = target.tokenAddress as Address;

    try {
      setStage('checking');
      if (!(await validateQuote(quoted))) return;
      // 1. The wallet has to be on the chain the receiver is deployed on. Every
      //    write below also names the chain, so wagmi refuses to sign on the
      //    wrong one even if this switch silently did nothing.
      if (connectedChainId !== target.chainId) {
        setStage('switching');
        await switchChainAsync({ chainId: target.chainId });
      }

      // 2. Enough USDC to pay at all? Checked before any signature, because the
      //    alternative is a wallet prompt for a transaction that can only
      //    revert, and a revert reads to the buyer as "the site is broken".
      const balance = await publicClient.readContract({
        address: token,
        abi: erc20ApprovalAbi,
        functionName: 'balanceOf',
        args: [address],
      });
      if (balance < amount) {
        fail(
          'insufficient-balance',
          'Your wallet does not hold enough USDC on this network for this purchase.',
          'quoted',
        );
        return;
      }

      // 3. Approve, but only if the existing allowance is short. An allowance
      //    outlives the quote that prompted it, so a second attempt after an
      //    expiry usually skips this — which is the whole reason the user is not
      //    asked to approve twice.
      const allowance = await publicClient.readContract({
        address: token,
        abi: erc20ApprovalAbi,
        functionName: 'allowance',
        args: [address, receiver],
      });

      if (allowance < amount) {
        // Capability discovery is read-only. Older wallets commonly reject it.
        const capabilities = await getCapabilities(config, {
          account: address,
          chainId: target.chainId,
          connector,
        }).catch(() => undefined);
        // "ready" requires a wallet upgrade; leave that user's existing wallet
        // configuration alone and use the sequential flow instead.
        if (capabilities?.atomic?.status === 'supported') {
          if (!(await validateQuote(quoted))) return;
          // Encode before marking the request submitted: malformed input is
          // a local error and must not strand the buyer in batch recovery.
          const calls = [
            {
              to: token,
              data: encodeFunctionData({
                abi: erc20ApprovalAbi,
                functionName: 'approve',
                args: [receiver, amount],
              }),
            },
            {
              to: receiver,
              data: encodeFunctionData({
                abi: usdcReceiverAbi,
                functionName: 'payIntentWithToken',
                args: [quoted.id as Hash, amount],
              }),
            },
          ];
          const pending: UsdcResumeRecord = {
            intentId: quoted.id,
            expiresAt: quoted.expiresAt?.toISOString(),
            batchId: crypto.randomUUID(),
            payer: address,
            sizeMib:
              requestedBytes === null
                ? null
                : Number(requestedBytes) / 1_048_576,
            chainId: target.chainId,
            confirmations: target.confirmations,
            settleGraceMs: target.settleGraceMs,
          };
          saveUsdcResume(pending);
          setStage('batching');
          paymentSubmitted.current = true;
          setMayHaveBroadcast(true);
          try {
            const sent = await sendCalls(config, {
              account: address,
              chainId: target.chainId,
              connector,
              id: pending.batchId,
              forceAtomic: true,
              // eslint-disable-next-line camelcase -- viem's option name
              experimental_fallback: false,
              calls,
            });
            const submitted = { ...pending, batchId: sent.id };
            saveUsdcResume(submitted);
            setBatch(submitted);
            setStage('batch-pending');
            return;
          } catch (error) {
            if (!wasNotSubmitted(error)) {
              setBatch(pending);
              setBatchStatusUnavailable(true);
              setStage('batch-pending');
              return;
            }
            clearUsdcResume();
            paymentSubmitted.current = false;
            setMayHaveBroadcast(false);
            // Fall back only on an explicit unsupported response. A timeout
            // may have submitted the batch, so falling back then could pay twice.
            if (!isBatchUnsupported(error)) throw error;
          }
        }
      }

      if (allowance < amount) {
        if (!isQuoteLive(quoted)) {
          setIntent(null);
          fail(
            'quote-expired',
            'The price expired. Get a fresh quote to continue.',
            'idle',
          );
          return;
        }
        setStage('approving');
        // Exactly the amount owed. Not an unlimited approval: this is a
        // one-off purchase, and leaving a standing allowance on a contract for
        // the convenience of a repeat purchase is a trade a buyer did not agree
        // to make.
        const approveHash = await writeContractAsync({
          address: token,
          abi: erc20ApprovalAbi,
          functionName: 'approve',
          args: [receiver, amount],
          chainId: target.chainId,
          account: address,
          connector,
        });
        setStage('approval-confirming');
        const approveReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveHash,
          confirmations: 1,
        });
        // A mined-and-reverted approval is not a failure the wallet reports:
        // writeContractAsync resolved, and only the receipt says what happened.
        // Paying on top of it would revert in turn, with no useful message.
        if (approveReceipt.status !== 'success') {
          fail(
            'failed',
            'The USDC approval did not go through. Please try again.',
            'quoted',
          );
          return;
        }
      } else {
        setApprovalSkipped(true);
      }

      // 4. Approval can take minutes. Check the lock again before opening the
      //    separate payment request; only the wallet can reject an open prompt.
      if (!isQuoteLive(quoted)) {
        setIntent(null);
        fail(
          'quote-expired',
          'The quoted price expired before the payment was sent. Get a fresh ' +
            'quote to continue — your USDC approval is still in place, so you ' +
            'will not be asked to approve again.',
          'idle',
        );
        return;
      }

      // Simulation is read-only, so its failures must never look like a
      // potentially submitted payment (including RPC timeouts at this stage).
      await publicClient.simulateContract({
        address: receiver,
        abi: usdcReceiverAbi,
        functionName: 'payIntentWithToken',
        args: [quoted.id as Hash, amount],
        account: address,
      });
      if (!(await validateQuote(quoted))) return;
      setStage('paying');
      // Latched BEFORE the call, because the call is the one that may not report
      // back. See `mayHaveBroadcast`: everything above is safe to retry, and
      // this is the line after which a retry can pay twice.
      setMayHaveBroadcast(true);
      paymentSubmitted.current = true;
      const hash = await writeContractAsync({
        address: receiver,
        abi: usdcReceiverAbi,
        functionName: 'payIntentWithToken',
        args: [quoted.id as Hash, amount],
        chainId: target.chainId,
        account: address,
        connector,
      });
      setPayTxHash(hash);
      setStage('submitted');
    } catch (error) {
      // Explicit refusals and local validation errors are safe to retry.
      // Timeouts, disconnects and unknown RPC errors remain ambiguous.
      if (wasNotSubmitted(error)) {
        paymentSubmitted.current = false;
        setMayHaveBroadcast(false);
      }
      // Back to `quoted`, not `idle`: the quote is untouched by a declined
      // signature or a failed switch, and asking for a new one would discard a
      // lock the buyer can still use.
      handleThrown(error, 'quoted');
    }
  }, [
    address,
    connectedChainId,
    config,
    connector,
    fail,
    handleThrown,
    intent,
    isQuoteLive,
    publicClient,
    requestedBytes,
    switchChainAsync,
    target,
    writeContractAsync,
    validateQuote,
  ]);

  /**
   * One payment at a time. See `payInFlight`.
   *
   * A wrapper rather than a check inside, because the run above leaves by seven
   * different routes and every one of them has to release the latch.
   */
  const pay = useCallback(async () => {
    if (payInFlight.current || paymentSubmitted.current) return;
    payInFlight.current = true;
    try {
      await runPay();
    } finally {
      payInFlight.current = false;
    }
  }, [runPay]);

  return useMemo(
    () => ({
      stage,
      batch,
      batchStatusUnavailable,
      isBusy,
      intent,
      payTxHash,
      isPaymentCompleted,
      failure,
      message,
      approvalSkipped,
      mayHaveBroadcast,
      quote,
      pay,
      reset,
      acknowledgeNotBroadcast,
    }),
    [
      stage,
      batch,
      batchStatusUnavailable,
      isBusy,
      intent,
      payTxHash,
      isPaymentCompleted,
      failure,
      message,
      approvalSkipped,
      mayHaveBroadcast,
      quote,
      pay,
      reset,
      acknowledgeNotBroadcast,
    ],
  );
};
