'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { erc20ApprovalAbi, usdcReceiverAbi } from '@auto-drive/ui';
import { UsdcPaymentTarget } from '@auto-drive/models';
import { Address, BaseError, Hash, UserRejectedRequestError } from 'viem';
import { ApiError, CreatedIntent } from '../services/api';
import { usePaymentIntent } from './usePaymentIntent';

/**
 * How far a USDC purchase has got. Rendered as a checklist, so the buyer can see
 * which of the two signatures they are being asked for and why.
 */
export type UsdcPurchaseStage =
  | 'idle'
  /** Asking the backend for a price. */
  | 'quoting'
  /** A live quote is in hand and nothing has been signed. The review gate. */
  | 'quoted'
  | 'switching'
  | 'approving'
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
  /** Something else went wrong. Offer a retry. */
  | 'failed';

/**
 * A margin, not a bare comparison: the payment needs time to be signed and
 * mined, and the backend rejects on ITS clock. Paying with twenty seconds left
 * is how a transaction lands just after expiry, which is the one outcome worse
 * than being told to start again.
 */
export const QUOTE_MIN_REMAINING_MS = 45_000;

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
 *   - **Nothing is paid against a lapsed quote.** The lock is checked immediately
 *     before the payment call, not merely when it was cut. A payment that arrives
 *     after expiry is refused and filed as a mispayment: the money is kept, no
 *     credits are granted, and only an admin can untangle it. Which makes the
 *     ordinary sequence — approve, get distracted, come back — a way to lose
 *     money, unless it is checked there.
 *
 * The approval survives an expired quote on purpose (an ERC20 allowance is not
 * tied to an intent), so the fresh attempt skips straight to paying when the new
 * quote is no larger.
 */
export const useUsdcPurchase = ({
  target,
  requestedBytes,
}: {
  target: UsdcPaymentTarget | undefined;
  requestedBytes: bigint | null;
}) => {
  const { address, chainId: connectedChainId } = useAccount();
  const { usdcPaymentIntent } = usePaymentIntent();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  // Pinned to the payment chain, not the connected one: every read below is
  // about Ethereum, and a wallet on Auto EVM must not make an allowance read
  // resolve against the wrong chain's state.
  const publicClient = usePublicClient({ chainId: target?.chainId });

  const [stage, setStage] = useState<UsdcPurchaseStage>('idle');
  const [intent, setIntent] = useState<CreatedIntent | null>(null);
  const [payTxHash, setPayTxHash] = useState<Hash | undefined>(undefined);
  const [failure, setFailure] = useState<UsdcPurchaseFailure | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Surfaced so the checklist can say "already approved" instead of silently
  // skipping a step the user was told to expect.
  const [approvalSkipped, setApprovalSkipped] = useState(false);

  const isBusy =
    stage !== 'idle' && stage !== 'quoted' && stage !== 'submitted';

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

  const reset = useCallback(() => {
    setStage('idle');
    setIntent(null);
    setPayTxHash(undefined);
    setFailure(null);
    setMessage(null);
    setApprovalSkipped(false);
  }, []);

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
      // the user chose to do. `walk` because wagmi wraps it: the rejection
      // arrives nested inside a ContractFunctionExecutionError.
      const rejected =
        error instanceof UserRejectedRequestError ||
        (error instanceof BaseError &&
          error.walk((e) => e instanceof UserRejectedRequestError) !== null);
      if (rejected) {
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
        error instanceof Error
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
  const pay = useCallback(async () => {
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
        });
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

      // 4. Pay — but only if the lock still holds. This is the check that
      //    matters: the approval above can take minutes, and a payment landing
      //    after expiry is refused, filed as a mispayment, and keeps the money
      //    with no credits granted.
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

      setStage('paying');
      const hash = await writeContractAsync({
        address: receiver,
        abi: usdcReceiverAbi,
        functionName: 'payIntentWithToken',
        args: [quoted.id as Hash, amount],
        chainId: target.chainId,
      });
      setPayTxHash(hash);
      setStage('submitted');
    } catch (error) {
      // Back to `quoted`, not `idle`: the quote is untouched by a declined
      // signature or a failed switch, and asking for a new one would discard a
      // lock the buyer can still use.
      handleThrown(error, 'quoted');
    }
  }, [
    address,
    connectedChainId,
    fail,
    handleThrown,
    intent,
    isQuoteLive,
    publicClient,
    switchChainAsync,
    target,
    writeContractAsync,
  ]);

  return useMemo(
    () => ({
      stage,
      isBusy,
      intent,
      payTxHash,
      failure,
      message,
      approvalSkipped,
      quote,
      pay,
      reset,
    }),
    [
      stage,
      isBusy,
      intent,
      payTxHash,
      failure,
      message,
      approvalSkipped,
      quote,
      pay,
      reset,
    ],
  );
};
