'use client';

import { Button, evmChains } from '@auto-drive/ui';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { parseGwei, type Hash } from 'viem';
import { useCallback, useEffect, useState } from 'react';
import { usePaymentIntent } from '../../../../hooks/usePaymentIntent';
import { useNetwork } from '../../../../contexts/network';
import { usePrices } from '../../../../hooks/usePrices';
import { useTransactionConfirmation } from '../../../../hooks/useTransactionConfirmation';
import { mibToBytes, normaliseMib } from '../../../../utils/credits';
import { readPaymentMethod } from '../../../../utils/purchaseCredits';
import { PaymentMethod } from '@auto-drive/models';
import { UsdcTransferPanel } from './UsdcTransferPanel';
import { WalletConnection } from '../molecules/WalletConnection';

type TransferStepProps = {
  onNext: (data?: Record<string, unknown>) => void;
  onBack: () => void;
  context: Record<string, unknown>;
};

/**
 * The payment step, dispatched by asset.
 *
 * Two panels rather than one with branches inside it. Paying in AI3 is a single
 * native-value call on Auto EVM; paying in USDC is a chain switch,
 * an ERC20 approval and a contract call on another chain, with a price lock
 * ticking through all three. Interleaving them would put every AI3 purchase —
 * which is every purchase today — through code written for the other one.
 *
 * `readPaymentMethod` rather than a direct read, because `context` is
 * re-hydrated from the query string and anything but the exact USDC value has to
 * land on AI3.
 */
export const PurchaseStep3TransferTokens = (props: TransferStepProps) =>
  readPaymentMethod(props.context.paymentMethod) === PaymentMethod.USDC_ETH ? (
    <UsdcTransferPanel {...props} />
  ) : (
    <Ai3TransferPanel {...props} />
  );

const Ai3TransferPanel = ({ onNext, onBack, context }: TransferStepProps) => {
  const {
    isConnected,
    chainId: connectedChainId,
    address,
    connector,
  } = useAccount();
  const { api, network } = useNetwork();
  const paymentChain = evmChains[network.id];
  const publicClient = usePublicClient({ chainId: paymentChain.id });
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const { formatCreditsInMbAsValue, formatCreditsInMbAsAi3 } = usePrices();
  const [intentId, setIntentId] = useState<string | undefined>(undefined);
  const [intentError, setIntentError] = useState<string | undefined>(undefined);
  const [isSending, setIsSending] = useState(false);

  const { paymentIntent, targetContract, MINIMUM_CONFIRMATIONS } =
    usePaymentIntent();

  const [txHash, setTxHash] = useState<Hash | undefined>(undefined);

  const {
    isWaitingReceipt,
    isConfirmed,
    currentConfs,
    isFullyConfirmed,
    isPollingBackend,
    isBackendCompleted,
    isOverCap,
    isExpired,
    lockLapsed,
    waitError,
  } = useTransactionConfirmation({
    txHash,
    requiredConfirmations: MINIMUM_CONFIRMATIONS,
    api,
    intentId,
    chainId: paymentChain.id,
  });

  const {
    writeContractAsync,
    isPending: isWriting,
    error: writeError,
  } = useWriteContract();

  // Normalised ONCE for the whole step, not per call site. The amount displayed
  // and the amount charged have to come from the same number, and this step is
  // reachable by deep link (`?step=3&sizeMB=…`), where `context.sizeMB` is not
  // guaranteed to be the whole MiB `inputToMib` produces — see normaliseMib.
  // Normalising inside handleSend alone would have shown the price of 0.5 MiB
  // while asking the wallet for 1 MiB.
  const sizeMib = normaliseMib(context.sizeMB);

  // A size that cannot be normalised is not a purchase, and no wallet prompt
  // should be raised for it. Disabling rather than failing on click is the
  // difference between "this link is broken" and "the button does nothing".
  const canSend =
    isConnected && !isSending && !isWriting && !txHash && sizeMib !== null;
  // Leaving unmounts this panel. Keep the payment request and its submitted
  // hash here until confirmation; a failed or rejected request can go back.
  const canGoBack = !isSending && !isWriting && !txHash;

  const handleSend = useCallback(async () => {
    setIsSending(true);
    setIntentError(undefined);
    try {
      // Defence in depth: `canSend` already gates the button on this, but
      // handleSend must not depend on a caller having checked.
      if (sizeMib === null) return;
      // A USDC purchase can leave the wallet on Ethereum or Sepolia. Switching
      // before creating the intent also avoids starting its expiry countdown
      // while the buyer is still approving the network change.
      if (connectedChainId !== paymentChain.id) {
        await switchChainAsync({ chainId: paymentChain.id, connector });
      }
      const depositTransaction = await paymentIntent(
        formatCreditsInMbAsValue(sizeMib),
        // The same byte count the payment is priced from — formatCreditsInMbAsValue
        // multiplies by exactly this before applying shannonsPerByte — so the
        // size the cap is checked against is the size the payment will grant.
        mibToBytes(sizeMib),
      );
      // Auto EVM is a Substrate-based network that does not support EIP-1559
      // fee history. Fetch the current gas price via eth_gasPrice and add a
      // 1 GWEI buffer so MetaMask can display the fee correctly and the tx
      // is reliably included without the user having to manually adjust gas.
      // When publicClient is unavailable, omit gasPrice entirely so the
      // wallet falls back to its own fee estimation.
      const gasPrice = publicClient
        ? (await publicClient.getGasPrice()) + parseGwei('1')
        : undefined;
      const hash = await writeContractAsync({
        ...depositTransaction,
        // Keep this explicit even after switching: the wallet can change
        // networks again while the intent or gas price request is in flight.
        chainId: paymentChain.id,
        account: address,
        connector,
        ...(gasPrice != null && { gasPrice }),
      });
      setIntentId(depositTransaction.intentId);
      setTxHash(hash);
    } catch (error) {
      console.error('Error sending payment intent', error);
      // wagmi's writeError only covers the wallet call. A failure before that —
      // now including a 403 when the purchase has no cap headroom left — has no
      // other channel, and without this the button would appear to do nothing.
      setIntentError(
        error instanceof Error ? error.message : 'Could not start the payment',
      );
    } finally {
      setIsSending(false);
    }
  }, [
    paymentIntent,
    formatCreditsInMbAsValue,
    sizeMib,
    publicClient,
    writeContractAsync,
    connectedChainId,
    paymentChain.id,
    switchChainAsync,
    address,
    connector,
  ]);

  const notifyAndNext = useCallback(async () => {
    if (!txHash || !intentId) return;
    try {
      await api.watchIntent(intentId, txHash);
    } catch {
      // ignore, UI proceeds regardless; backend will retry on its own if needed
    }
  }, [api, intentId, txHash]);

  // Notify backend when confirmed and proceed
  useEffect(() => {
    if (isConfirmed && txHash) {
      void notifyAndNext();
    }
  }, [api, isConfirmed, notifyAndNext, onNext, txHash]);

  return (
    <div className='flex flex-col gap-4'>
      <Section title='Transfer AI3 Tokens'>
        <div className='flex flex-col gap-4'>
          {/* Step 1: Ensure wallet connected */}
          <WalletConnection
            isBusy={isSending || isWriting}
            connectedMessage={
              !txHash && connectedChainId !== paymentChain.id
                ? `Connected — will switch to Auto EVM (${paymentChain.name}) when you pay`
                : 'Wallet connected'
            }
          />

          {/* Step 2: Send transfer */}
          <div className='flex flex-col gap-3 rounded-md bg-muted p-4'>
            <div className='text-sm font-medium'>Send AI3 Transfer</div>
            <InfoRow
              label='Network'
              value={<span>Auto EVM ({paymentChain.name})</span>}
            />
            <InfoRow
              label='Recipient'
              value={<span>{targetContract || '—'}</span>}
            />
            <InfoRow
              label='Amount'
              value={
                <span>
                  {sizeMib === null
                    ? '—'
                    : `${formatCreditsInMbAsAi3(sizeMib).toFixed(2)} AI3`}
                </span>
              }
            />
            <div className='flex gap-3'>
              <Button
                type='button'
                variant='outline'
                onClick={onBack}
                disabled={!canGoBack}
              >
                Back
              </Button>
              <Button onClick={handleSend} disabled={!canSend}>
                {isSwitching
                  ? 'Switching network…'
                  : isSending || isWriting
                    ? 'Sending…'
                    : 'Send Transfer'}
              </Button>
            </div>
            {sizeMib === null && (
              <div className='text-xs text-red-600'>
                This link does not carry a valid purchase size. Start again from
                package selection to choose one.
              </div>
            )}
            {(intentError || writeError) && (
              <div role='alert' className='text-xs text-red-600'>
                {intentError ||
                  writeError?.message ||
                  'Missing deposit transaction'}
              </div>
            )}
          </div>

          {/* Step 3: Wait for inclusion */}
          {txHash && (
            <div className='flex flex-col gap-3 rounded-md bg-muted p-4'>
              <div className='text-sm font-medium'>Confirmation</div>
              <InfoRow label='Transaction Hash' value={<span>{txHash}</span>} />
              <div className='text-xs text-muted-foreground'>
                {isWaitingReceipt
                  ? 'Waiting for transaction to be included…'
                  : 'Included'}
              </div>
              {isConfirmed && (
                <div className='text-xs text-muted-foreground'>
                  {currentConfs}/{MINIMUM_CONFIRMATIONS} confirmations
                </div>
              )}
              {isConfirmed && (
                <div className='mt-1 w-full'>
                  <div className='h-2 w-full rounded bg-muted-foreground/20'>
                    <div
                      className='h-2 rounded bg-green-600'
                      style={{
                        width: `${Math.min(
                          100,
                          Math.floor(
                            (currentConfs / MINIMUM_CONFIRMATIONS) * 100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
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
              {/* The lock lapsed and the outcome is still open. Reachable on
                  AI3 too — an intent expires ten minutes after it is created,
                  and a transfer signed near that edge confirms after it — and
                  what settles it either way is the polling loop, which keeps
                  running through the caution. */}
              {lockLapsed &&
                !isBackendCompleted &&
                !isOverCap &&
                !isExpired && (
                  <div className='rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'>
                    <strong>Price lock lapsed.</strong> This payment confirmed
                    after the quote&apos;s price lock ran out, so we are still
                    confirming that it was accepted. Keep this page open — if it
                    is not credited shortly, contact support for assistance.
                  </div>
                )}
              {isExpired && (
                <div className='rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300'>
                  <strong>Payment expired.</strong> The payment window for this
                  transaction has closed and credits will not be applied. Please
                  try again or contact support for assistance.
                </div>
              )}
              {waitError && (
                <div className='text-xs text-red-600'>{waitError.message}</div>
              )}
              <div className='flex gap-3'>
                <Button
                  // sizeMB travels forward as the normalised value, so the
                  // success screen reports the size that was bought rather than
                  // the one the URL happened to carry.
                  onClick={() =>
                    onNext({
                      txHash,
                      intentId,
                      paymentMethod: PaymentMethod.AI3_NATIVE,
                      sizeMB: sizeMib,
                    })
                  }
                  disabled={!isFullyConfirmed || !isBackendCompleted || isOverCap || isExpired}
                >
                  {isFullyConfirmed && !isBackendCompleted && !isOverCap && !isExpired
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
