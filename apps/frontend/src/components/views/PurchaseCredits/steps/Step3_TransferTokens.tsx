'use client';

import { Button } from '@auto-drive/ui';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { parseGwei, type Hash } from 'viem';
import { useCallback, useEffect, useState } from 'react';
import { usePaymentIntent } from '../../../../hooks/usePaymentIntent';
import { useNetwork } from '../../../../contexts/network';
import { usePrices } from '../../../../hooks/usePrices';
import { useTransactionConfirmation } from '../../../../hooks/useTransactionConfirmation';
import { mibToBytes, normaliseMib } from '../../../../utils/credits';

export const PurchaseStep3TransferTokens = ({
  onNext,
  onBack,
  context,
}: {
  onNext: (data?: Record<string, unknown>) => void;
  onBack: () => void;
  context: Record<string, unknown>;
}) => {
  void onBack;
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient();
  const { formatCreditsInMbAsValue, formatCreditsInMbAsAi3 } = usePrices();
  const [intentId, setIntentId] = useState<string | undefined>(undefined);
  const [intentError, setIntentError] = useState<string | undefined>(undefined);

  const { paymentIntent, targetContract, MINIMUM_CONFIRMATIONS } =
    usePaymentIntent();
  const { api } = useNetwork();

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
    waitError,
  } = useTransactionConfirmation({
    txHash,
    requiredConfirmations: MINIMUM_CONFIRMATIONS,
    api,
    intentId,
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
  const canSend = isConnected && !isWriting && !txHash && sizeMib !== null;

  const handleConnect = () => {
    if (openConnectModal) openConnectModal();
  };

  const handleSend = useCallback(async () => {
    setIntentError(undefined);
    try {
      // Defence in depth: `canSend` already gates the button on this, but
      // handleSend must not depend on a caller having checked.
      if (sizeMib === null) return;
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
    }
  }, [
    paymentIntent,
    formatCreditsInMbAsValue,
    sizeMib,
    publicClient,
    writeContractAsync,
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
          <div className='flex items-center justify-between rounded-md bg-muted p-4'>
            <div className='flex flex-col'>
              <div className='text-sm font-medium'>Wallet Connection</div>
              <div className='text-xs text-muted-foreground'>
                {isConnected
                  ? 'Wallet connected'
                  : 'Please connect your wallet to continue'}
              </div>
            </div>
            {isConnected ? (
              <span className='text-xs font-semibold text-green-700'>
                {address}
              </span>
            ) : (
              <Button onClick={handleConnect}>Connect Wallet</Button>
            )}
          </div>

          {/* Step 2: Send transfer */}
          <div className='flex flex-col gap-3 rounded-md bg-muted p-4'>
            <div className='text-sm font-medium'>Send AI3 Transfer</div>
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
              <Button onClick={handleSend} disabled={!canSend}>
                {isWriting ? 'Sending…' : 'Send Transfer'}
              </Button>
            </div>
            {sizeMib === null && (
              // Stated up front rather than on click, because this step has no
              // back button — the only way out is to start the purchase again,
              // and the user needs to know that before pressing anything.
              <div className='text-xs text-red-600'>
                This link does not carry a valid purchase size. Start again from
                package selection to choose one.
              </div>
            )}
            {(intentError || writeError) && (
              <div className='text-xs text-red-600'>
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
                  onClick={() => onNext({ txHash, sizeMB: sizeMib })}
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
