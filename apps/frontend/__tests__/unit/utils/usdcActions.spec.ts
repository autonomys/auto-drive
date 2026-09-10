import { describe, it, expect } from '@jest/globals';
import {
  evaluateUsdcActions,
  UsdcActionInputs,
} from '../../../src/utils/usdcActions';

/**
 * The two buttons that move a USDC purchase, and the one asymmetry between
 * them: quoting obeys the availability gates, paying an existing quote does not.
 */

// A connected wallet on a deployment that is selling, with nothing signed yet.
const OPEN: UsdcActionInputs = {
  isConnected: true,
  isBusy: false,
  hasSubmittedPayment: false,
  sizeMib: 1024,
  hasTarget: true,
  knowsChain: true,
  isAvailable: true,
  awaitingConfirmation: false,
  quoteStale: false,
};

// The review gate: a live quote in hand, waiting on the buyer's second click.
const QUOTED: UsdcActionInputs = { ...OPEN, awaitingConfirmation: true };

describe('evaluateUsdcActions', () => {
  it('offers a quote and nothing else before one exists', () => {
    expect(evaluateUsdcActions(OPEN)).toEqual({
      canQuote: true,
      canPay: false,
    });
  });

  it('offers payment and not a re-quote while a live quote is in hand', () => {
    // Re-quoting here would discard the lock the buyer is looking at and open a
    // second intent at a new rate.
    expect(evaluateUsdcActions(QUOTED)).toEqual({
      canQuote: false,
      canPay: true,
    });
  });

  it('turns a stale quote back into a re-quote', () => {
    expect(evaluateUsdcActions({ ...QUOTED, quoteStale: true })).toEqual({
      canQuote: true,
      canPay: false,
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // The asymmetry
  // ──────────────────────────────────────────────────────────────────────────

  it('stops quoting when the gates close', () => {
    // A new intent would be refused by the backend, so the click has nothing to
    // offer but an error message.
    expect(evaluateUsdcActions({ ...OPEN, isAvailable: false }).canQuote).toBe(
      false,
    );
  });

  it('still pays a quote granted before the gates closed', () => {
    // The regression this module exists for. ['features'] has no staleTime and
    // no refetchOnWindowFocus override, so it refetches whenever the window
    // regains focus — which the wallet's own popup causes. A gate closing in
    // that window used to disable Pay on a live lock and send the buyer to AI3,
    // while the intent sat there PENDING and creditable: nothing on the
    // settlement path reads the gates.
    expect(evaluateUsdcActions({ ...QUOTED, isAvailable: false })).toEqual({
      canQuote: false,
      canPay: true,
    });
  });

  it('does not pay a quote that has gone stale, gates open or closed', () => {
    // Availability is not a way around the price lock: past the margin the
    // payment would land after expiry and be filed as a mispayment.
    for (const isAvailable of [true, false]) {
      expect(
        evaluateUsdcActions({ ...QUOTED, quoteStale: true, isAvailable })
          .canPay,
      ).toBe(false);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Conditions that stop BOTH, including one a closed gate used to cover for
  // ──────────────────────────────────────────────────────────────────────────

  it('stops both when this build does not know the target chain', () => {
    // Not a gate and never self-clearing. Load-bearing on the pay side too:
    // wagmi cannot switch to a chain it was never configured with, and
    // usePublicClient returns nothing for one — so pay() would abort silently,
    // with no balance read and no signature.
    expect(evaluateUsdcActions({ ...QUOTED, knowsChain: false })).toEqual({
      canQuote: false,
      canPay: false,
    });
  });

  it('stops both without a payment target', () => {
    expect(evaluateUsdcActions({ ...QUOTED, hasTarget: false })).toEqual({
      canQuote: false,
      canPay: false,
    });
  });

  it('stops both once a payment is on chain', () => {
    // Live or resumed from a reload: either way the money has moved and a
    // second attempt would charge twice for one purchase.
    expect(
      evaluateUsdcActions({ ...QUOTED, hasSubmittedPayment: true }),
    ).toEqual({ canQuote: false, canPay: false });
  });

  it('stops both while a wallet interaction is in flight', () => {
    expect(evaluateUsdcActions({ ...QUOTED, isBusy: true })).toEqual({
      canQuote: false,
      canPay: false,
    });
  });

  it('stops both with no wallet connected', () => {
    expect(evaluateUsdcActions({ ...QUOTED, isConnected: false })).toEqual({
      canQuote: false,
      canPay: false,
    });
  });

  it('stops both when the link carried no valid purchase size', () => {
    expect(evaluateUsdcActions({ ...QUOTED, sizeMib: null })).toEqual({
      canQuote: false,
      canPay: false,
    });
  });

  it('treats a zero size as a size', () => {
    // `sizeMib !== null`, not truthiness: zero is rejected upstream by the
    // wizard, and conflating it with a missing value here would hide which
    // check refused.
    expect(evaluateUsdcActions({ ...OPEN, sizeMib: 0 }).canQuote).toBe(true);
  });
});
