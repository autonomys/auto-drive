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
import { UserRejectedRequestError } from 'viem';

// ---------------------------------------------------------------------------
// Stubs (before the import under test)
// ---------------------------------------------------------------------------

const readContract =
  jest.fn<(args: { functionName: string }) => Promise<bigint>>();
const writeContractAsync = jest.fn<(args: unknown) => Promise<string>>();
const waitForTransactionReceipt = jest.fn<() => Promise<{ status: string }>>();
const switchChainAsync = jest.fn<(args: unknown) => Promise<unknown>>();
const usdcPaymentIntent = jest.fn<(bytes: bigint) => Promise<unknown>>();

let connectedChainId = 1;

jest.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x000000000000000000000000000000000000dEaD',
    chainId: connectedChainId,
  }),
  usePublicClient: () => ({ readContract, waitForTransactionReceipt }),
  useSwitchChain: () => ({ switchChainAsync }),
  useWriteContract: () => ({ writeContractAsync }),
}));

jest.mock('@auto-drive/ui', () => ({
  erc20ApprovalAbi: [],
  usdcReceiverAbi: [],
}));

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

const AMOUNT = 12_500_000n;
const REQUESTED_BYTES = 1_073_741_824n;

/** A quote with `minutes` of lock left. */
const quoteIn = (minutes: number) => ({
  id: '0xabc',
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

const setup = () =>
  renderHook(() =>
    useUsdcPurchase({ target: TARGET, requestedBytes: REQUESTED_BYTES }),
  );

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(payCall.args).toEqual(['0xabc', AMOUNT]);
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

  it('does nothing at all without a quote in hand', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.pay();
    });

    await waitFor(() => expect(result.current.stage).toBe('idle'));
    expect(writeContractAsync).not.toHaveBeenCalled();
  });
});
