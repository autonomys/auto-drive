/**
 * Which of the USDC panel's buttons may be clicked — its two actions here, and
 * its one exit at the bottom of the file.
 *
 * Pure, and outside the component, for the same reason `intentPolling` is: this
 * is a decision about money rather than a render, and every defect found in the
 * USDC panel so far has been in exactly these booleans. A copy of them in a test
 * file would have stayed green through all of them.
 *
 * The asymmetry between the two is the whole content of this module. Quoting and
 * paying look like two halves of one action and are gated on different things.
 */

export type UsdcActionInputs = {
  isConnected: boolean;
  /** A wallet interaction is in flight. */
  isBusy: boolean;
  /** A payment is already on chain, live or resumed from a reload. */
  hasSubmittedPayment: boolean;
  /** null when the URL carried no valid purchase size. */
  sizeMib: number | null;
  /** `GET /payments/usdc/target` has answered. */
  hasTarget: boolean;
  /**
   * This build can talk to the chain the target names.
   *
   * Not a gate that closes — a deployment/build mismatch — and load-bearing for
   * BOTH actions: wagmi cannot switch a wallet to a chain it was never
   * configured with, and `usePublicClient` returns nothing for one, so `pay()`
   * would abort with no balance read and no signature.
   */
  knowsChain: boolean;
  /** `payWithUsdc` from /features, narrowed by the backend to audience AND gates. */
  isAvailable: boolean;
  /** A quote is in hand and nothing has been signed — the review gate. */
  awaitingConfirmation: boolean;
  /** That quote is too close to expiry to pay safely. */
  quoteStale: boolean;
  /**
   * A payment call was entered and never reported back, so the transaction may
   * already be on chain. See `mayHaveBroadcast` in useUsdcPurchase.
   */
  mayHaveBroadcast: boolean;
};

export type UsdcActions = {
  canQuote: boolean;
  canPay: boolean;
};

export const evaluateUsdcActions = ({
  isConnected,
  isBusy,
  hasSubmittedPayment,
  sizeMib,
  hasTarget,
  knowsChain,
  isAvailable,
  awaitingConfirmation,
  quoteStale,
  mayHaveBroadcast,
}: UsdcActionInputs): UsdcActions => {
  // What any wallet interaction needs. Availability is deliberately absent —
  // see canPay.
  const walletReady =
    isConnected &&
    !isBusy &&
    !mayHaveBroadcast &&
    !hasSubmittedPayment &&
    sizeMib !== null &&
    hasTarget &&
    knowsChain;

  return {
    // Quoting opens a NEW intent, so it obeys the gates: a closed path answers
    // 403/503 and the click would only surface that as an error message.
    canQuote:
      walletReady && isAvailable && (!awaitingConfirmation || quoteStale),

    // Paying does NOT, and that is the point.
    //
    // A quote already granted stays payable for the rest of its lock however the
    // gates move afterwards, because nothing on the settlement path reads them:
    // the receiver's event subscription credits from the deposit event, and
    // `markIntentAsConfirmed` refuses only on the status column. The backend
    // says as much by serving `GET /payments/usdc/target` ungated — "where does
    // the money go" is not "is this open" — precisely so a client mid-flow is
    // not stranded.
    //
    // Requiring `isAvailable` here stranded it anyway, one layer up. The
    // ['features'] query has no staleTime and no refetchOnWindowFocus override,
    // so it refetches every time the window regains focus — which the wallet's
    // own popup causes — and a gate closing between the two clicks disabled Pay
    // on a live lock and sent the buyer to AI3 for a purchase that would have
    // been credited.
    // `mayHaveBroadcast` shuts it regardless. The intent is reused by design,
    // and the receiver has no per-intent replay guard, so a second click on a
    // payment that may already be on chain transfers the amount twice: one is
    // credited and the other filed as ALREADY_SETTLED. Only the buyer can say
    // which happened, and the panel asks them.
    canPay:
      walletReady && awaitingConfirmation && !quoteStale && !mayHaveBroadcast,
  };
};

/**
 * May the buyer leave this step?
 *
 * Its own function rather than a third key above, because it is not a decision
 * about money — it is the one exit from a screen that closes every other one.
 *
 * `hasLivePayment` is a nudge rather than a guard, and worth being honest about:
 * the panel writes the hash to `sessionStorage` in the effect that follows it,
 * so leaving does not normally lose it — that write is allowed to fail silently,
 * which is the one case it does. What it buys is that a buyer who has just paid
 * stays on the screen counting the confirmations, instead of wandering off
 * during the ~72s and returning to a wizard that looks like it forgot.
 *
 * A RESUMED hash — one this panel read back on mount — is not passed here at
 * all. It is proof the record exists, so there is nothing left to nudge about,
 * and treating it as live made a reload into a dead end: it was set before
 * anything could stall, and shut every exit on a purchase nothing would resolve.
 *
 * `confirmationStalled` is the live half of that. viem gives up on a receipt
 * after 180s and react-query retries three times, so a transaction that was
 * never mined — dropped, replaced, underpriced — or an Ethereum RPC that is not
 * answering pins this step for about twelve minutes. There is nothing left to
 * watch by then.
 *
 * A pending batch is different: no receipt has been resolved yet, and leaving
 * could start another purchase while the wallet still executes the first.
 * Block that exit for both live and resumed batches, even after an RPC error.
 */
export const canLeaveUsdcStep = ({
  isBusy,
  hasLivePayment,
  hasUnresolvedPayment,
  confirmationStalled,
}: {
  isBusy: boolean;
  /** A payment was submitted in this mount — not one restored from storage. */
  hasLivePayment: boolean;
  /** A batch or server-reported payment without a hash has no safe retry. */
  hasUnresolvedPayment: boolean;
  confirmationStalled: boolean;
}): boolean =>
  !isBusy && !hasUnresolvedPayment && (!hasLivePayment || confirmationStalled);
