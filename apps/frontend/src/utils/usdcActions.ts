/**
 * Which of the USDC panel's two buttons may be clicked.
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
}: UsdcActionInputs): UsdcActions => {
  // What any wallet interaction needs. Availability is deliberately absent —
  // see canPay.
  const walletReady =
    isConnected &&
    !isBusy &&
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
    canPay: walletReady && awaitingConfirmation && !quoteStale,
  };
};
