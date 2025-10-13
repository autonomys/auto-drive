import { useEffect, useRef, useState } from 'react';
import { usePublicClient, useWaitForTransactionReceipt } from 'wagmi';
import { type Hash } from 'viem';
import { useQueryClient } from '@tanstack/react-query';

interface UseTransactionConfirmationProps {
  txHash: Hash | undefined;
  requiredConfirmations?: number;
  api?: {
    getIntent: (intentId: string) => Promise<{ status: string }>;
  };
  intentId?: string;
}

interface UseTransactionConfirmationReturn {
  isWaitingReceipt: boolean;
  isConfirmed: boolean;
  currentConfs: number;
  isFullyConfirmed: boolean;
  isPollingBackend: boolean;
  isBackendCompleted: boolean;
  waitError: Error | null;
}

export const useTransactionConfirmation = ({
  txHash,
  requiredConfirmations = 12,
  api,
  intentId,
}: UseTransactionConfirmationProps): UseTransactionConfirmationReturn => {
  const client = usePublicClient();
  const stopRef = useRef(false);
  const queryClient = useQueryClient();

  const {
    isLoading: isWaitingReceipt,
    isSuccess: isConfirmed,
    error: waitError,
  } = useWaitForTransactionReceipt({ hash: txHash, confirmations: 1 });

  // Track confirmations post-inclusion
  const [currentConfs, setCurrentConfs] = useState(0);
  const [isFullyConfirmed, setIsFullyConfirmed] = useState(false);

  // Backend polling state
  const [isPollingBackend, setIsPollingBackend] = useState(false);
  const [isBackendCompleted, setIsBackendCompleted] = useState(false);

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
          queryClient.invalidateQueries({ queryKey: ['account'] });
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
  }, [api, intentId, isFullyConfirmed, isBackendCompleted, queryClient]);

  return {
    isWaitingReceipt,
    isConfirmed,
    currentConfs,
    isFullyConfirmed,
    isPollingBackend,
    isBackendCompleted,
    waitError,
  };
};
