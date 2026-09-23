/**
 * @jest-environment jsdom
 */

/**
 * The state machine that moves a buyer's USDC.
 *
 * These are the cases where getting it wrong costs money rather than a render:
 * paying against a lapsed quote (refused on arrival, filed as a mispayment,
 * admin-only to untangle), asking for a second approval that strands the first,
 * or re-quoting under a buyer who has already confirmed a figure. None of them
 * is reachable through the pure helpers around the hook, which is why the hook
 * itself is driven here.
 *
 * The wallet, the chain reads and the API are all stubbed: what is under test is
 * the ORDER of the decisions and what each one does, not viem.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { UserRejectedRequestError, decodeFunctionData, parseAbi } from 'viem';
import {
  readUsdcResume,
  type UsdcResumeRecord,
} from '../../../src/utils/usdcResume';

// ---------------------------------------------------------------------------
// Stubs (before the import under test)
// ---------------------------------------------------------------------------

const readContract =
  jest.fn<(args: { functionName: string }) => Promise<bigint>>();
const writeContractAsync = jest.fn<(args: unknown) => Promise<string>>();
const waitForTransactionReceipt = jest.fn<() => Promise<{ status: string }>>();
const switchChainAsync = jest.fn<(args: unknown) => Promise<unknown>>();
const usdcPaymentIntent = jest.fn<(bytes: bigint) => Promise<unknown>>();
const simulateContract = jest.fn<() => Promise<unknown>>();
const getCapabilities = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const sendCalls = jest.fn<(...args: unknown[]) => Promise<{ id: string }>>();
const getCallsStatus = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const config = {};
const connector = { uid: 'wallet' };

let connectedChainId = 1;

jest.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x000000000000000000000000000000000000dEaD',
    chainId: connectedChainId,
    connector,
  }),
  useConfig: () => config,
  usePublicClient: () => ({
    readContract,
    waitForTransactionReceipt,
    simulateContract,
  }),
  useSwitchChain: () => ({ switchChainAsync }),
  useWriteContract: () => ({ writeContractAsync }),
}));

jest.mock('wagmi/actions', () => ({
  getCapabilities,
  sendCalls,
  getCallsStatus,
}));

jest.mock('@auto-drive/ui', () => {
  const { parseAbi } = jest.requireActual<typeof import('viem')>('viem');
  return {
    erc20ApprovalAbi: parseAbi([
      'function approve(address spender, uint256 amount) returns (bool)',
    ]),
    usdcReceiverAbi: parseAbi([
      'function payIntentWithToken(bytes32 intentId, uint256 amount)',
    ]),
  };
});

jest.mock('../../../src/hooks/usePaymentIntent', () => ({
  usePaymentIntent: () => ({ usdcPaymentIntent }),
}));

import { useUsdcPurchase } from '../../../src/hooks/useUsdcPurchase';
import { ApiError } from '../../../src/services/api';

const TARGET = {
  chainId: 1,
  receiverAddress: '0x1111111111111111111111111111111111111111',
  tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  tokenDecimals: 6,
  confirmations: 6,
  settleGraceMs: 120_000,
};

const INTENT_ID = `0x${'ab'.repeat(32)}`;
const AMOUNT = 12_500_000n;
const REQUESTED_BYTES = 1_073_741_824n;

/** A quote with `minutes` of lock left. */
const quoteIn = (minutes: number) => ({
  id: INTENT_ID,
  paymentMethod: 'usdc_eth',
  expiresAt: new Date(Date.now() + minutes * 60_000),
  quotedTokenAmount: AMOUNT,
});

const balances = ({
  balance = AMOUNT,
  allowance = 0n,
}: { balance?: bigint; allowance?: bigint } = {}) => {
  readContract.mockImplementation(async ({ functionName }) =>
    functionName === 'balanceOf' ? balance : allowance,
  );
};

const setup = (resumed?: UsdcResumeRecord | null) =>
  renderHook(() =>
    useUsdcPurchase({
      target: TARGET,
      requestedBytes: REQUESTED_BYTES,
      resumed,
    }),
  );

beforeEach(() => {
  jest.resetAllMocks();
  sessionStorage.clear();
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => 'test-batch-id',
  });
  getCapabilities.mockResolvedValue({});
  sendCalls.mockResolvedValue({ id: 'test-batch-id' });
  getCallsStatus.mockResolvedValue({
    chainId: 1,
    statusCode: 100,
    status: 'pending',
  });
  simulateContract.mockResolvedValue({});
  connectedChainId = 1;
  usdcPaymentIntent.mockResolvedValue(quoteIn(10));
  writeContractAsync.mockResolvedValue('0xdeadbeef');
  waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
  switchChainAsync.mockResolvedValue(undefined);
  balances();
});

// ---------------------------------------------------------------------------
// The review gate
// ---------------------------------------------------------------------------

describe('quote', () => {
  it('stops at a live quote without touching the wallet', async () => {
    // The property the two-act split exists for. A buyer must see the figure
    // standing still before anything asks them to sign; one click that quotes
    // AND signs shows the number and the prompt at the same instant.
    const { result } = setup();

    await act(async () => {
      await result.current.quote();
    });

    expect(result.current.stage).toBe('quoted');
    expect(result.current.intent?.quotedTokenAmount).toBe(AMOUNT);
    expect(writeContractAsync).not.toHaveBeenCalled();
    expect(switchChainAsync).not.toHaveBeenCalled();
  });

  it('refuses a quote that arrives already expired, and does not offer a retry', async () => {
    // Clock skew, not an expired price: the backend locks for ten minutes from
    // its own `now`, so a dead quote on arrival means the two clocks disagree.
    // Reported as `failed` rather than `quote-expired` because the retry that
    // reason offers would create an intent per click, forever.
    usdcPaymentIntent.mockResolvedValue({
      ...quoteIn(10),
      expiresAt: new Date(Date.now() - 1000),
    });
    const { result } = setup();

    await act(async () => {
      await result.current.quote();
    });

    expect(result.current.failure).toBe('failed');
    expect(result.current.message).toMatch(/out of sync/);
    expect(result.current.intent).toBeNull();
  });

  it('falls back to AI3 on a coded refusal rather than on the wording', async () => {
    usdcPaymentIntent.mockRejectedValue(
      new ApiError(
        503,
        'Paying in USDC is temporarily unavailable.',
        'USDC_PAYMENTS_UNAVAILABLE',
      ),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.quote();
    });

    expect(result.current.failure).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

describe('pay', () => {
  const quoteThen = async (
    result: { current: ReturnType<typeof useUsdcPurchase> },
    after?: () => void,
  ) => {
    await act(async () => {
      await result.current.quote();
    });
    after?.();
    await act(async () => {
      await result.current.pay();
    });
  };

  it('approves the exact amount and pays, in that order', async () => {
    const { result } = setup();
    await quoteThen(result);

    expect(writeContractAsync).toHaveBeenCalledTimes(2);
    const [approve, payCall] = writeContractAsync.mock.calls.map(
      (c) => c[0] as { functionName: string; args: unknown[] },
    );
    expect(approve.functionName).toBe('approve');
    // Never an unlimited approval: this is a one-off purchase, and a standing
    // allowance on a payment contract is a trade the buyer did not agree to.
    expect(approve.args[1]).toBe(AMOUNT);
    expect(payCall.functionName).toBe('payIntentWithToken');
    expect(payCall.args).toEqual([INTENT_ID, AMOUNT]);
    expect(result.current.stage).toBe('submitted');
    expect(result.current.payTxHash).toBe('0xdeadbeef');
  });

  it('skips the approval when the standing allowance already covers it', async () => {
    // Why an expiry-then-retry does not ask for a second signature: an ERC20
    // allowance is not tied to an intent and outlives the quote that prompted it.
    balances({ allowance: AMOUNT });
    const { result } = setup();
    await quoteThen(result);

    expect(result.current.approvalSkipped).toBe(true);
    expect(sendCalls).not.toHaveBeenCalled();
    expect(getCapabilities).not.toHaveBeenCalled();
    expect(writeContractAsync).toHaveBeenCalledTimes(1);
    expect(
      (writeContractAsync.mock.calls[0][0] as { functionName: string })
        .functionName,
    ).toBe('payIntentWithToken');
  });

  it('refuses to pay against a lock that lapsed after the quote', async () => {
    // The check that protects the money. The approval above can take minutes,
    // and a payment arriving after expiry is refused and filed as a mispayment:
    // money kept, no credits, admin only. So the lock is re-read immediately
    // before the payment call, not merely when the quote was cut.
    const { result } = setup();
    await act(async () => {
      await result.current.quote();
    });

    // The lock lapses while the approval is in the wallet.
    waitForTransactionReceipt.mockImplementation(async () => {
      jest.setSystemTime(Date.now() + 11 * 60_000);
      return { status: 'success' };
    });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(Date.now());

    await act(async () => {
      await result.current.pay();
    });
    jest.useRealTimers();

    expect(result.current.failure).toBe('quote-expired');
    // Approved, never paid: exactly one write.
    expect(writeContractAsync).toHaveBeenCalledTimes(1);
    expect(result.current.payTxHash).toBeUndefined();
    // The intent is dropped, so the retry re-quotes rather than paying a price
    // the backend will not honour.
    expect(result.current.intent).toBeNull();
  });

  it('refuses a quote that died at the review gate, before any wallet call', async () => {
    // The gate is a place to sit — that is what it is for — so the figure the
    // buyer is reading can lapse while they read it. Discovering that only
    // after a chain switch and an approval signature is a wallet prompt they
    // never needed to see.
    const { result } = setup();
    await act(async () => {
      await result.current.quote();
    });

    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(Date.now() + 11 * 60_000);
    await act(async () => {
      await result.current.pay();
    });
    jest.useRealTimers();

    expect(result.current.failure).toBe('quote-expired');
    expect(switchChainAsync).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
    expect(writeContractAsync).not.toHaveBeenCalled();
    // Dropped, so the retry re-quotes rather than paying a price the backend
    // will not honour.
    expect(result.current.intent).toBeNull();
  });

  it('checks the balance before asking for any signature', async () => {
    // A wallet prompt for a transaction that can only revert reads to a buyer
    // as "the site is broken".
    balances({ balance: AMOUNT - 1n });
    const { result } = setup();
    await quoteThen(result);

    expect(result.current.failure).toBe('insufficient-balance');
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it('treats a mined-and-reverted approval as a failure', async () => {
    // writeContractAsync resolves either way — only the receipt says what
    // happened — and paying on top of a failed approval reverts with no message.
    waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' });
    const { result } = setup();
    await quoteThen(result);

    expect(result.current.failure).toBe('failed');
    expect(writeContractAsync).toHaveBeenCalledTimes(1);
  });

  it('switches the chain only when the wallet is elsewhere', async () => {
    const { result } = setup();
    await quoteThen(result);
    expect(switchChainAsync).not.toHaveBeenCalled();

    connectedChainId = 11155111;
    const second = setup();
    await quoteThen(second.result);
    expect(switchChainAsync).toHaveBeenCalledWith({ chainId: 1 });
  });

  it('keeps the quote when the buyer declines in their wallet', async () => {
    // A declined prompt is a choice, not an error, and it costs nothing — so
    // the next click should be Pay again, not a fresh price at a new rate.
    writeContractAsync.mockRejectedValue(
      new UserRejectedRequestError(new Error('User rejected the request.')),
    );
    const { result } = setup();
    await quoteThen(result);

    expect(result.current.failure).toBe('rejected');
    expect(result.current.stage).toBe('quoted');
    expect(result.current.intent).not.toBeNull();
    expect(usdcPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('never creates a second intent for one purchase', async () => {
    // Two intents for one purchase strands the first, whose approval the buyer
    // has already given, and leaves the backend filing the payment against
    // whichever id the client last remembered.
    const { result } = setup();
    await quoteThen(result);
    await act(async () => {
      await result.current.pay();
    });

    expect(usdcPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('pays once when the button is double-clicked', async () => {
    // The ordinary path has no `setStage` before the first await — the wallet is
    // already on the payment chain and the allowance already covers — so `isBusy`
    // is still false through both RPC reads and the button is still enabled and
    // still reads Pay. Two clicks inside that window both reach
    // `payIntentWithToken` on the SAME intent, and the receiver has no replay
    // guard: one transfer is credited, the other filed as ALREADY_SETTLED.
    balances({ allowance: AMOUNT });
    const { result } = setup();
    await act(async () => {
      await result.current.quote();
    });

    await act(async () => {
      await Promise.all([result.current.pay(), result.current.pay()]);
    });

    const payments = writeContractAsync.mock.calls.filter(
      (c) =>
        (c[0] as { functionName: string }).functionName ===
        'payIntentWithToken',
    );
    expect(payments).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // The payment call that does not report back
  // -------------------------------------------------------------------------

  /** Resolve the approval, then fail the payment call with `error`. */
  const failThePaymentWith = (error: unknown) => {
    writeContractAsync
      .mockResolvedValueOnce('0xapproval')
      .mockRejectedValueOnce(error);
  };

  it('will not offer Pay again when the payment call simply stops answering', async () => {
    // `writeContractAsync` resolves only once the transaction is broadcast, but
    // it can REJECT after `eth_sendTransaction` has gone out — a timeout, a
    // dropped connection. The transaction is then on chain with nothing here
    // recording it, and the intent is reused by design: a second click pays a
    // second time, and only one of the two is ever credited.
    failThePaymentWith(new Error('request timed out'));
    const { result } = setup();
    await quoteThen(result);

    expect(result.current.mayHaveBroadcast).toBe(true);
    // The quote is untouched — this is not a lapsed price — so what must stop
    // the second payment is this flag and nothing else.
    expect(result.current.stage).toBe('quoted');
    expect(result.current.intent).not.toBeNull();
  });

  it('offers Pay again when the wallet says it declined', async () => {
    // The one failure that proves nothing was sent. Treating it like the rest
    // would make the commonest way out of this flow — changing your mind —
    // require an acknowledgement about a transaction that does not exist.
    failThePaymentWith(
      new UserRejectedRequestError(new Error('user rejected')),
    );
    const { result } = setup();
    await quoteThen(result);

    expect(result.current.mayHaveBroadcast).toBe(false);
    expect(result.current.failure).toBe('rejected');
  });

  it('pays again only once the buyer says their wallet is empty-handed', async () => {
    failThePaymentWith(new Error('request timed out'));
    const { result } = setup();
    await quoteThen(result);

    act(() => {
      result.current.acknowledgeNotBroadcast();
    });

    expect(result.current.mayHaveBroadcast).toBe(false);
    // And the acknowledgement clears the error with it: what is on screen next
    // is the Pay button, not a failure the buyer has just answered.
    expect(result.current.failure).toBeNull();

    writeContractAsync.mockResolvedValue('0xdeadbeef');
    await act(async () => {
      await result.current.pay();
    });

    // The SAME intent, which is the point of the flag: paying twice against one
    // intent is what the backend files as ALREADY_SETTLED.
    expect(usdcPaymentIntent).toHaveBeenCalledTimes(1);
    expect(result.current.payTxHash).toBe('0xdeadbeef');
  });

  it('does nothing at all without a quote in hand', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.pay();
    });

    await waitFor(() => expect(result.current.stage).toBe('idle'));
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it('does not show an uncertain payment for a failed read-only simulation', async () => {
    simulateContract.mockRejectedValue(new Error('RPC timed out'));
    const { result } = setup();
    await quoteThen(result);
    expect(writeContractAsync).toHaveBeenCalledTimes(1); // Approval only.
    expect(result.current.mayHaveBroadcast).toBe(false);
    expect(result.current.stage).toBe('quoted');
  });

  it('allows retry after an explicit provider refusal, including wrapped errors', async () => {
    failThePaymentWith({ cause: { code: 4100 } });
    const { result } = setup();
    await quoteThen(result);
    expect(result.current.mayHaveBroadcast).toBe(false);
  });

  it('does not let acknowledgement or another click race an open wallet prompt', async () => {
    balances({ allowance: AMOUNT });
    let finish!: (hash: string) => void;
    writeContractAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = setup();
    await act(async () => {
      await result.current.quote();
    });
    let payment!: Promise<void>;
    await act(async () => {
      payment = result.current.pay();
    });
    expect(result.current.stage).toBe('paying');
    act(() => {
      result.current.acknowledgeNotBroadcast();
    });
    expect(result.current.mayHaveBroadcast).toBe(true);
    await act(async () => {
      await result.current.pay();
      finish('0xpaid');
      await payment;
    });
    await act(async () => {
      await result.current.pay();
    });
    expect(writeContractAsync).toHaveBeenCalledTimes(1);
  });

  it('blocks new quotes and payments after a lost payment response', async () => {
    failThePaymentWith(new Error('timeout'));
    const { result } = setup();
    await quoteThen(result);
    act(() => {
      result.current.reset();
    });
    await act(async () => {
      await result.current.quote();
      await result.current.pay();
    });
    expect(usdcPaymentIntent).toHaveBeenCalledTimes(1);
    expect(writeContractAsync).toHaveBeenCalledTimes(2);
  });

  describe('atomic wallet payments', () => {
    const confirmed = {
      chainId: 1,
      atomic: true,
      statusCode: 200,
      status: 'success',
      receipts: [{ status: 'success', transactionHash: '0xpaid' }],
    };

    beforeEach(() => {
      getCapabilities.mockResolvedValue({ atomic: { status: 'supported' } });
    });

    it('rejects invalid payment calldata before saving or submitting a batch', async () => {
      usdcPaymentIntent.mockResolvedValue({ ...quoteIn(10), id: '0xabc' });
      const { result } = setup();
      await quoteThen(result);
      expect(result.current.failure).toBe('failed');
      expect(result.current.mayHaveBroadcast).toBe(false);
      expect(readUsdcResume(1024)).toBeNull();
      expect(sendCalls).not.toHaveBeenCalled();
    });

    it('sends exact approval and payment as one atomic batch and follows its receipt', async () => {
      getCallsStatus.mockResolvedValue(confirmed);
      const { result } = setup();
      await quoteThen(result);
      await waitFor(() => expect(result.current.payTxHash).toBe('0xpaid'));
      expect(writeContractAsync).not.toHaveBeenCalled();
      expect(sendCalls).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          account: '0x000000000000000000000000000000000000dEaD',
          chainId: 1,
          forceAtomic: true,
          experimental_fallback: false,
        }),
      );
      const request = sendCalls.mock.calls[0][1] as {
        calls: { to: string; data: `0x${string}` }[];
      };
      expect(request.calls).toHaveLength(2);
      expect(request.calls.map((call) => call.to)).toEqual([
        TARGET.tokenAddress,
        TARGET.receiverAddress,
      ]);
      expect(
        decodeFunctionData({
          abi: parseAbi([
            'function approve(address spender, uint256 amount) returns (bool)',
          ]),
          data: request.calls[0].data,
        }).args,
      ).toEqual([TARGET.receiverAddress, AMOUNT]);
      expect(
        decodeFunctionData({
          abi: parseAbi([
            'function payIntentWithToken(bytes32 intentId, uint256 amount)',
          ]),
          data: request.calls[1].data,
        }).args,
      ).toEqual([INTENT_ID, AMOUNT]);
      expect(readUsdcResume(1024)?.txHash).toBe('0xpaid');
    });

    it.each(['unsupported', 'ready'])(
      'uses the existing flow for atomic status %s',
      async (status) => {
        getCapabilities.mockResolvedValue({ atomic: { status } });
        const { result } = setup();
        await quoteThen(result);
        expect(sendCalls).not.toHaveBeenCalled();
        expect(writeContractAsync).toHaveBeenCalledTimes(2);
      },
    );

    it('supports wallets without capability discovery', async () => {
      getCapabilities.mockRejectedValue({ code: -32601 });
      const { result } = setup();
      await quoteThen(result);
      expect(sendCalls).not.toHaveBeenCalled();
      expect(writeContractAsync).toHaveBeenCalledTimes(2);
    });

    it('falls back only when the batch request explicitly reports lack of support', async () => {
      sendCalls.mockRejectedValue({ cause: { code: 5760 } });
      const { result } = setup();
      await quoteThen(result);
      expect(writeContractAsync).toHaveBeenCalledTimes(2);
      expect(result.current.payTxHash).toBe('0xdeadbeef');
    });

    it('does not fall back when the buyer declines the batch', async () => {
      sendCalls.mockRejectedValue({ cause: { code: 4001 } });
      const { result } = setup();
      await quoteThen(result);
      expect(result.current.failure).toBe('rejected');
      expect(result.current.mayHaveBroadcast).toBe(false);
      expect(readUsdcResume(1024)).toBeNull();
      expect(writeContractAsync).not.toHaveBeenCalled();
    });

    it('recovers a lost submission response using the saved client batch ID', async () => {
      sendCalls.mockImplementation(async () => {
        expect(readUsdcResume(1024)?.batchId).toBe('test-batch-id');
        throw new Error('wallet timed out');
      });
      getCallsStatus.mockResolvedValue(confirmed);
      const { result } = setup();
      await quoteThen(result);
      await waitFor(() => expect(result.current.payTxHash).toBe('0xpaid'));
      expect(getCallsStatus).toHaveBeenCalledWith(config, {
        id: 'test-batch-id',
        connector,
      });
      expect(writeContractAsync).not.toHaveBeenCalled();
    });

    it('keeps tracking a pending batch across a reload without another signature', async () => {
      const first = setup();
      await quoteThen(first.result);
      const saved = readUsdcResume(1024);
      expect(saved?.batchId).toBe('test-batch-id');
      first.unmount();
      getCallsStatus.mockResolvedValue(confirmed);
      const next = setup(saved);
      await waitFor(() => expect(next.result.current.payTxHash).toBe('0xpaid'));
      expect(sendCalls).toHaveBeenCalledTimes(1);
      expect(writeContractAsync).not.toHaveBeenCalled();
    });

    it('polls a pending batch until the payment receipt arrives', async () => {
      jest.useFakeTimers();
      try {
        const { result } = setup();
        await quoteThen(result);
        expect(result.current.stage).toBe('batch-pending');
        getCallsStatus.mockResolvedValue(confirmed);
        await act(async () => {
          await jest.advanceTimersByTimeAsync(3000);
        });
        expect(result.current.payTxHash).toBe('0xpaid');
        expect(sendCalls).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('recovers a resumed batch even when the payment target is unavailable', async () => {
      getCallsStatus.mockResolvedValue(confirmed);
      const { result } = renderHook(() =>
        useUsdcPurchase({
          target: undefined,
          requestedBytes: REQUESTED_BYTES,
          resumed: {
            intentId: INTENT_ID,
            batchId: 'saved-batch',
            sizeMib: 1024,
            chainId: 1,
            payer: '0x000000000000000000000000000000000000dEaD',
          },
        }),
      );
      await waitFor(() => expect(result.current.payTxHash).toBe('0xpaid'));
      expect(sendCalls).not.toHaveBeenCalled();
      expect(writeContractAsync).not.toHaveBeenCalled();
    });

    it('waits for the original payer before querying the saved batch', () => {
      const { result } = setup({
        intentId: INTENT_ID,
        batchId: 'saved-batch',
        sizeMib: 1024,
        chainId: 1,
        payer: TARGET.receiverAddress,
      });
      expect(result.current.stage).toBe('batch-pending');
      expect(getCallsStatus).not.toHaveBeenCalled();
    });

    it.each([400, 500])(
      'allows retry after terminal batch failure %s',
      async (statusCode) => {
        getCallsStatus.mockResolvedValue({
          chainId: 1,
          statusCode,
          status: 'failure',
        });
        const { result } = setup();
        await quoteThen(result);
        await waitFor(() => expect(result.current.failure).toBe('failed'));
        expect(result.current.mayHaveBroadcast).toBe(false);
        expect(result.current.batch).toBeNull();
        expect(readUsdcResume(1024)).toBeNull();
        getCallsStatus.mockResolvedValue(confirmed);
        await act(async () => {
          await result.current.pay();
        });
        await waitFor(() => expect(result.current.payTxHash).toBe('0xpaid'));
      },
    );

    it.each([
      { chainId: 1, statusCode: 600, status: 'failure' },
      { ...confirmed, chainId: 2 },
      { ...confirmed, atomic: false },
      { ...confirmed, receipts: [] },
    ])(
      'never retries an ambiguous or inconsistent batch result: %j',
      async (status) => {
        getCallsStatus.mockResolvedValue(status);
        const { result } = setup();
        await quoteThen(result);
        await waitFor(() =>
          expect(result.current.batchStatusUnavailable).toBe(true),
        );
        act(() => {
          result.current.acknowledgeNotBroadcast();
          result.current.reset();
        });
        await act(async () => {
          await result.current.pay();
          await result.current.quote();
        });
        expect(sendCalls).toHaveBeenCalledTimes(1);
        expect(writeContractAsync).not.toHaveBeenCalled();
        expect(usdcPaymentIntent).toHaveBeenCalledTimes(1);
        expect(result.current.payTxHash).toBeUndefined();
      },
    );

    it('keeps an uncertain batch locked when status RPC fails', async () => {
      getCallsStatus.mockRejectedValue(new Error('disconnected'));
      const { result } = setup();
      await quoteThen(result);
      await waitFor(() =>
        expect(result.current.batchStatusUnavailable).toBe(true),
      );
      expect(result.current.mayHaveBroadcast).toBe(true);
      expect(readUsdcResume(1024)?.batchId).toBe('test-batch-id');
    });

    it('checks expiry again after capability discovery', async () => {
      jest.useFakeTimers();
      try {
        getCapabilities.mockImplementation(async () => {
          jest.setSystemTime(Date.now() + 11 * 60_000);
          return { atomic: { status: 'supported' } };
        });
        const { result } = setup();
        await quoteThen(result);
        expect(result.current.failure).toBe('quote-expired');
        expect(sendCalls).not.toHaveBeenCalled();
        expect(writeContractAsync).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
