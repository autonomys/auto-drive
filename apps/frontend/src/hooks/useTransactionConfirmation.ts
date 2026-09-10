import { useEffect, useRef, useState } from 'react';
import { usePublicClient, useWaitForTransactionReceipt } from 'wagmi';
import { type Hash } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../services/api';
import {
  evaluateIntentStatus,
  evaluatePollError,
} from '../utils/intentPolling';

interface UseTransactionConfirmationProps {
  txHash: Hash | undefined;
  requiredConfirmations?: number;
  api?: {
    getIntent: (intentId: string) => Promise<{ status: string }>;
  };
  intentId?: string;
  /**
   * Pin the receipt and block watching to one chain, rather than following
   * whichever chain the wallet happens to be on.
   *
   * Needed once a purchase can settle somewhere other than the connected chain.
   * A USDC payment is made on Ethereum, and the moment it is submitted the user
   * is free to switch their wallet back to Auto EVM — which, unpinned, swaps the
   * public client under this hook mid-count. `isFullyConfirmed` would then never
   * arrive, and the Continue button would stay disabled for a purchase whose
   * credits had already been granted.
   *
   * Omitted keeps the previous behaviour exactly: follow the connected chain,
   * which is correct for AI3 because that IS the chain being paid on.
   */
  chainId?: number;
  /**
   * How long the backend may keep answering 410 before the purchase is called
   * lost. Served by `GET /payments/usdc/target` as `settleGraceMs`, because it
   * is a multiple of the backend's own credit-granting interval rather than
   * anything this build knows — see `utils/intentPolling`.
   *
   * Omitted falls back to the module default, which is what the AI3 step uses.
   */
  lockLapsedGraceMs?: number;
}

interface UseTransactionConfirmationReturn {
  isWaitingReceipt: boolean;
  isConfirmed: boolean;
  currentConfs: number;
  isFullyConfirmed: boolean;
  isPollingBackend: boolean;
  isBackendCompleted: boolean;
  /** True when the backend put the intent in the over_cap terminal state. */
  isOverCap: boolean;
  /**
   * True only once the intent's expiry is TERMINAL: the backend has answered
   * 410 for long enough that no settlement is coming, so credits will not be
   * applied without an admin.
   *
   * Deliberately not the first 410. That one means `expires_at` has passed on a
   * row still sitting at PENDING, which is a state a payment settles out of —
   * see `utils/intentPolling`. Reporting it as final told buyers their money was
   * gone while their credits were landing seconds later.
   */
  isExpired: boolean;
  /**
   * True while the backend reports the price lock lapsed and the outcome is
   * still open — the caution that belongs to a 410 before it is terminal.
   *
   * Clears on the next successful read, because a 2xx from `getIntent` is
   * itself the statement that the lock is no longer being reported as lapsed.
   */
  lockLapsed: boolean;
  /**
   * True once `getIntent` has answered 2xx at least once.
   *
   * Exported so a caller holding its OWN lapsed-lock caution — the USDC panel
   * raises one from a 410 on `POST /intents/:id/watch`, before this loop is even
   * running — can withdraw it on the same evidence this hook withdraws
   * `lockLapsed` on. Without it that caution has nothing to clear it and stands
   * over a purchase the backend is plainly still settling.
   */
  hasReadIntent: boolean;
  waitError: Error | null;
}

export const useTransactionConfirmation = ({
  txHash,
  requiredConfirmations = 12,
  api,
  intentId,
  chainId,
  lockLapsedGraceMs,
}: UseTransactionConfirmationProps): UseTransactionConfirmationReturn => {
  // `chainId: undefined` is how wagmi spells "the connected chain", so passing
  // it through unset preserves the AI3 behaviour rather than special-casing it.
  const client = usePublicClient({ chainId });
  const stopRef = useRef(false);
  const queryClient = useQueryClient();

  const {
    isLoading: isWaitingReceipt,
    isSuccess: isConfirmed,
    error: waitError,
  } = useWaitForTransactionReceipt({ hash: txHash, confirmations: 1, chainId });

  // Track confirmations post-inclusion
  const [currentConfs, setCurrentConfs] = useState(0);
  const [isFullyConfirmed, setIsFullyConfirmed] = useState(false);

  // Backend polling state
  const [isPollingBackend, setIsPollingBackend] = useState(false);
  const [isBackendCompleted, setIsBackendCompleted] = useState(false);
  const [isOverCap, setIsOverCap] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [lockLapsed, setLockLapsed] = useState(false);
  const [hasReadIntent, setHasReadIntent] = useState(false);
  // When the loop first saw a 410, which is what makes the grace measurable.
  // A ref rather than state: the poll effect must not restart when it moves,
  // and nothing renders from it.
  const lapsedSinceRef = useRef<number | null>(null);

  // Start watching block numbers to compute confirmations once included
  useEffect(() => {
    if (!client || !txHash || !isConfirmed) return;
    let unwatch: (() => void) | undefined;
    let baseBlockNumber: bigint | undefined;

    // Cleared on every run, because the cleanup below sets it and this effect
    // re-runs whenever `client` or `requiredConfirmations` changes. Left latched,
    // the re-run's watcher returns on its first block and the count freezes at
    // one — Continue disabled forever on a purchase that confirmed. Reachable on
    // the AI3 path, where `client` follows whatever chain the wallet is on.
    stopRef.current = false;

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
    if (
      !api ||
      !intentId ||
      !isFullyConfirmed ||
      isBackendCompleted ||
      isOverCap ||
      isExpired
    )
      return;
    setIsPollingBackend(true);
    let timer: NodeJS.Timeout | undefined;
    let cancelled = false;

    const poll = async () => {
      // One decision table for both branches, in utils/intentPolling, where the
      // reasoning about what a 410 actually means lives and can be tested.
      const decision = await api
        .getIntent(intentId)
        .then((intent) => {
          setHasReadIntent(true);
          return evaluateIntentStatus(intent.status);
        })
        .catch((error: unknown) =>
          evaluatePollError(
            // The narrowing the pure decision cannot do for itself: only an
            // ApiError carries a status the backend chose.
            error instanceof ApiError ? error.status : null,
            {
              lapsedSince: lapsedSinceRef.current,
              now: Date.now(),
              graceMs: lockLapsedGraceMs,
            },
          ),
        );

      switch (decision.state) {
        case 'completed':
          // Refresh both the legacy account query and the new credit summary
          queryClient.invalidateQueries({ queryKey: ['account'] });
          queryClient.invalidateQueries({ queryKey: ['creditSummary'] });
          setLockLapsed(false);
          setIsBackendCompleted(true);
          setIsPollingBackend(false);
          return;
        case 'over_cap':
          // Payment received, cap reached. Terminal without an admin.
          setIsOverCap(true);
          setIsPollingBackend(false);
          return;
        case 'expired':
          // The lock stayed lapsed past the grace, so nothing is settling.
          setIsExpired(true);
          setIsPollingBackend(false);
          return;
        case 'lock-lapsed':
          // Warn, and keep polling: this is the state a late payment is
          // credited out of, and giving up here is how the UI came to report a
          // successful purchase as lost.
          if (lapsedSinceRef.current === null) {
            lapsedSinceRef.current = Date.now();
          }
          setLockLapsed(true);
          break;
        case 'live':
          // A 2xx means the backend is no longer calling the lock lapsed, so
          // any caution raised earlier is withdrawn — including the one the
          // hash registration raised before this loop started.
          lapsedSinceRef.current = null;
          setLockLapsed(false);
          break;
        case 'unknown':
          // A failure that says nothing about the intent. Retry, touch nothing.
          break;
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
  }, [
    api,
    intentId,
    isFullyConfirmed,
    isBackendCompleted,
    isOverCap,
    isExpired,
    lockLapsedGraceMs,
    queryClient,
  ]);

  return {
    isWaitingReceipt,
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
  };
};
