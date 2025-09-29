'use client';

import { Button } from '@auto-drive/ui';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { type Hash } from 'viem';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePaymentIntent } from '../../../../hooks/usePaymentIntent';
import { useNetwork } from '../../../../contexts/network';
import { usePrices } from '../../../../hooks/usePrices';

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
  const { formatCreditsInMbAsValue, formatCreditsInMbAsAi3 } = usePrices();
  const [intentId, setIntentId] = useState<string | undefined>(undefined);

  const { paymentIntent, targetContract } = usePaymentIntent();
  const { api } = useNetwork();

  const [txHash, setTxHash] = useState<Hash | undefined>(undefined);
  const {
    isLoading: isWaitingReceipt,
    isSuccess: isConfirmed,
    error: waitError,
  } = useWaitForTransactionReceipt({ hash: txHash, confirmations: 1 });

  // Track confirmations post-inclusion
  const client = usePublicClient();
  const requiredConfirmations = 12;
  const [currentConfs, setCurrentConfs] = useState(0);
  const [isFullyConfirmed, setIsFullyConfirmed] = useState(false);
  const stopRef = useRef(false);

  // Backend polling state
  const [isPollingBackend, setIsPollingBackend] = useState(false);
  const [isBackendCompleted, setIsBackendCompleted] = useState(false);

  const {
    writeContractAsync,
    isPending: isWriting,
    error: writeError,
  } = useWriteContract();

  const canSend = isConnected && !isWriting && !txHash;

  const handleConnect = () => {
    if (openConnectModal) openConnectModal();
  };

  const handleSend = useCallback(async () => {
    try {
      const depositTransaction = await paymentIntent(
        formatCreditsInMbAsValue(Number(context.sizeMB)),
      );
      const hash = await writeContractAsync(depositTransaction);
      setIntentId(depositTransaction.intentId);
      setTxHash(hash);
    } catch (error) {
      console.error('Error sending payment intent', error);
      // no-op; UI will surface writeError via wagmi
    }
  }, [
    paymentIntent,
    formatCreditsInMbAsValue,
    context.sizeMB,
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

  // Start watching block numbers to compute confirmations once included
  useEffect(() => {
    if (!client || !txHash || !isConfirmed) return;
    let unwatch: (() => void) | undefined;
    let baseBlockNumber: bigint | undefined;

    const start = async () => {
      try {
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        baseBlockNumber = receipt.blockNumber;
        setCurrentConfs(1);
        setIsFullyConfirmed(1 >= requiredConfirmations);

        unwatch = client.watchBlockNumber({
          onBlockNumber: (bn) => {
            if (stopRef.current || !baseBlockNumber) return;
            const confs = Number(bn - baseBlockNumber + BigInt(1));
            const bounded = Math.max(1, Math.min(requiredConfirmations, confs));
            setCurrentConfs(bounded);
            if (bounded >= requiredConfirmations) {
              setIsFullyConfirmed(true);
              stopRef.current = true;
              if (unwatch) unwatch();
            }
          },
          emitMissed: true,
        });
      } catch {
        // no-op
      }
    };

    void start();
    return () => {
      stopRef.current = true;
      if (unwatch) unwatch();
    };
  }, [client, isConfirmed, requiredConfirmations, txHash]);

  // After confirmations threshold, poll backend until IntentStatus.COMPLETED
  useEffect(() => {
    if (!api || !intentId || !isFullyConfirmed || isBackendCompleted) return;
    setIsPollingBackend(true);
    let timer: NodeJS.Timeout | undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const intent = await api.getIntent(intentId);
        if (intent.status === 'completed') {
          setIsBackendCompleted(true);
          setIsPollingBackend(false);
          return;
        }
      } catch {
        // ignore and retry
      }
      if (!cancelled) {
        timer = setTimeout(poll, 2000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, intentId, isFullyConfirmed, isBackendCompleted]);

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
                  {formatCreditsInMbAsAi3(Number(context.sizeMB)).toFixed(2)}{' '}
                  AI3
                </span>
              }
            />
            <div className='flex gap-3'>
              <Button onClick={handleSend} disabled={!canSend}>
                {isWriting ? 'Sending…' : 'Send Transfer'}
              </Button>
            </div>
            {writeError && (
              <div className='text-xs text-red-600'>
                {writeError?.message || 'Missing deposit transaction'}
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
                  {currentConfs}/{requiredConfirmations} confirmations
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
                            (currentConfs / requiredConfirmations) * 100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              {isFullyConfirmed && (
                <div className='text-xs text-muted-foreground'>
                  {isPollingBackend
                    ? 'Waiting for backend to update credits…'
                    : ''}
                </div>
              )}
              {waitError && (
                <div className='text-xs text-red-600'>{waitError.message}</div>
              )}
              <div className='flex gap-3'>
                <Button
                  onClick={() => onNext({ txHash })}
                  disabled={!isFullyConfirmed || !isBackendCompleted}
                >
                  {isFullyConfirmed && !isBackendCompleted
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
