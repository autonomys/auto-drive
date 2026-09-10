/**
 * @jest-environment jsdom
 */

/**
 * The hook itself, not the decision table under it.
 *
 * `useTransactionConfirmation.spec` covers `utils/intentPolling`, which is pure.
 * What it cannot reach is the bookkeeping around those decisions — the block
 * watcher's stop flag, and when a caution is withdrawn — and both of those have
 * already produced the same class of bug: a purchase that settled fine reported
 * as one that did not, with Continue disabled over granted credits.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Wagmi, stubbed down to the two things this hook asks it for
// ---------------------------------------------------------------------------

type BlockHandler = (bn: bigint) => void;

let blockHandlers: BlockHandler[] = [];
let unwatchCount = 0;
let receiptBlock = 100n;
/** Bumped to hand the hook a NEW client object, as a chain switch would. */
let clientEpoch = 0;

// One object per epoch, because that is what wagmi does: `usePublicClient`
// returns a memoised client and hands back a NEW one only when the chain it is
// pinned to changes. A fresh object per render would re-run the effect under
// every setState here and test the mock rather than the hook.
const clients = new Map<number, unknown>();
const publicClient = () => {
  if (!clients.has(clientEpoch)) {
    clients.set(clientEpoch, {
      epoch: clientEpoch,
      getTransactionReceipt: async () => ({ blockNumber: receiptBlock }),
      watchBlockNumber: ({
        onBlockNumber,
      }: {
        onBlockNumber: BlockHandler;
      }) => {
        blockHandlers.push(onBlockNumber);
        return () => {
          unwatchCount += 1;
        };
      },
    });
  }
  return clients.get(clientEpoch);
};

let isConfirmed = true;

jest.mock('wagmi', () => ({
  usePublicClient: () => publicClient(),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: isConfirmed,
    error: null,
  }),
}));

import { useTransactionConfirmation } from '../../../src/hooks/useTransactionConfirmation';
import { ApiError } from '../../../src/services/api';

const QUIET: QueryClientConfig = {
  defaultOptions: { queries: { retry: false } },
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient(QUIET) },
    children,
  );

const TX = '0xdead' as `0x${string}`;

const emitBlock = async (bn: bigint) => {
  await act(async () => {
    blockHandlers.forEach((h) => h(bn));
  });
};

beforeEach(() => {
  clients.clear();
  blockHandlers = [];
  unwatchCount = 0;
  receiptBlock = 100n;
  clientEpoch = 0;
  isConfirmed = true;
});

// ---------------------------------------------------------------------------
// The confirmation counter
// ---------------------------------------------------------------------------

describe('confirmation counting', () => {
  it('counts blocks up to the required depth', async () => {
    const { result } = renderHook(
      () =>
        useTransactionConfirmation({ txHash: TX, requiredConfirmations: 3 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.currentConfs).toBe(1));
    await emitBlock(101n);
    expect(result.current.currentConfs).toBe(2);
    await emitBlock(102n);
    expect(result.current.currentConfs).toBe(3);
    expect(result.current.isFullyConfirmed).toBe(true);
  });

  it('keeps counting after the public client is swapped underneath it', async () => {
    // The regression this guards. The effect's cleanup sets a stop flag and the
    // flag was never cleared, so a re-run — which a wallet chain switch causes,
    // by handing `usePublicClient` a different client — installed a watcher that
    // returned on its first block. Confirmations froze at one, `isFullyConfirmed`
    // never arrived, and Continue stayed disabled on a purchase that confirmed.
    const { result, rerender } = renderHook(
      () =>
        useTransactionConfirmation({ txHash: TX, requiredConfirmations: 3 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.currentConfs).toBe(1));

    clientEpoch += 1;
    await act(async () => {
      rerender();
    });
    await waitFor(() => expect(unwatchCount).toBeGreaterThan(0));

    await emitBlock(101n);
    await emitBlock(102n);

    expect(result.current.currentConfs).toBe(3);
    expect(result.current.isFullyConfirmed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Backend polling
// ---------------------------------------------------------------------------

describe('backend polling', () => {
  const drive = async (statuses: Array<string | ApiError>) => {
    const queue = [...statuses];
    const getIntent = jest.fn(async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next instanceof ApiError) throw next;
      return { status: next };
    });

    const view = renderHook(
      () =>
        useTransactionConfirmation({
          txHash: TX,
          requiredConfirmations: 1,
          api: { getIntent },
          intentId: 'i-1',
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(view.result.current.isFullyConfirmed).toBe(true),
    );
    return view;
  };

  it('reports a completed intent and stops', async () => {
    const { result } = await drive(['completed']);
    await waitFor(() => expect(result.current.isBackendCompleted).toBe(true));
    expect(result.current.isPollingBackend).toBe(false);
    expect(result.current.hasReadIntent).toBe(true);
  });

  it('raises a caution on a 410 without calling the purchase lost', async () => {
    const { result } = await drive([new ApiError(410, 'Gone')]);

    await waitFor(() => expect(result.current.lockLapsed).toBe(true));
    // The distinction that matters: a lapsed lock is not a withheld credit.
    expect(result.current.isExpired).toBe(false);
    expect(result.current.hasReadIntent).toBe(false);
  });

  it('withdraws the caution as soon as one read succeeds', async () => {
    // `hasReadIntent` is what the USDC panel hangs its OWN caution on — the one
    // raised by a 410 from the hash registration, before this loop even starts.
    // Without it that notice stood over a purchase plainly still settling.
    const { result } = await drive([new ApiError(410, 'Gone'), 'confirmed']);

    await waitFor(() => expect(result.current.hasReadIntent).toBe(true), {
      timeout: 3_000,
    });
    expect(result.current.lockLapsed).toBe(false);
    expect(result.current.isExpired).toBe(false);
  });

  it('honours the grace it is given rather than a constant of its own', async () => {
    // Served as `settleGraceMs`; a zero grace makes the first 410 terminal,
    // which is exactly what the default must NOT do.
    const getIntent = jest.fn(async () => {
      throw new ApiError(410, 'Gone');
    });

    const { result } = renderHook(
      () =>
        useTransactionConfirmation({
          txHash: TX,
          requiredConfirmations: 1,
          api: { getIntent },
          intentId: 'i-1',
          lockLapsedGraceMs: 0,
        }),
      { wrapper },
    );

    // 3s, because the loop's own retry gap is 2s and RTL waits 1s by default.
    // A default here would be a test that passes on timing rather than on
    // behaviour.
    await waitFor(() => expect(result.current.isExpired).toBe(true), {
      timeout: 3_000,
    });
    expect(result.current.isPollingBackend).toBe(false);
  });

  it('keeps polling through an unrelated failure', async () => {
    const { result } = await drive([new ApiError(500, 'Boom'), 'completed']);

    await waitFor(() => expect(result.current.isBackendCompleted).toBe(true), {
      timeout: 3_000,
    });
    expect(result.current.isExpired).toBe(false);
    expect(result.current.lockLapsed).toBe(false);
  });
});
