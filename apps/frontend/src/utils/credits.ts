/**
 * Pure utility functions for credit cap, expiry and payment presentation.
 * Extracted so they can be unit-tested without a React environment.
 */

import { PaymentMethod } from '@auto-drive/models';
import { shannonsToAi3 } from '@autonomys/auto-utils';
import { formatUsdcAmount } from './usdc';

/**
 * Whole MiB to bytes.  The single conversion used both to decide locally
 * whether a purchase fits under the cap and to tell the backend what size to
 * check — the client's own verdict and the number the server re-checks must
 * come from the same arithmetic, or a purchase can pass here and be rejected
 * there.
 */
export const mibToBytes = (mib: number): bigint =>
  BigInt(mib) * BigInt(1024 * 1024);

/**
 * Coerce an untrusted size into the whole MiB the rest of this module requires,
 * or null when it is not a size at all.
 *
 * `sizeMB` normally comes from `inputToMib`, which already rounds. But it is
 * also re-hydrated from the query string by PurchaseCredits/index.tsx, whose
 * numeric coercion accepts anything matching `^-?\d+(\.\d+)?$` — so
 * `?step=3&sizeMB=0.5` puts a fraction into the same variable, and a
 * non-numeric `?sizeMB=abc` puts a string there. `BigInt()` throws a RangeError
 * on both, which reaches the user as `The number 0.5 cannot be converted to a
 * BigInt`.
 *
 * Deliberately NOT folded into `mibToBytes` as a rounding guard. Callers pass
 * the same size to `mibToBytes` and to the AI3 pricing helper, and only the
 * former would round — pricing the payment at 0.5 MiB while cap-checking 1 MiB,
 * which is the exact divergence `mibToBytes` exists to prevent. Normalising
 * once, before either is called, keeps them derived from one number.
 *
 * `Number.isSafeInteger` rather than `Number.isFinite`, because finite is not
 * enough: `?sizeMB=1e308` and a 308-digit `?sizeMB=999…9` both survive rounding
 * as finite doubles, and the pricing helper then evaluates `mib * 1048576` to
 * `Infinity` before its own `BigInt()` — the same RangeError this exists to
 * remove, one conversion earlier. Anything a purchase could legitimately be is
 * many orders of magnitude below 2^53 (the per-account cap is ~102,400 MiB), so
 * nothing real is excluded.
 */
export const normaliseMib = (value: unknown): number | null => {
  const mib = Math.round(Number(value));
  if (!Number.isSafeInteger(mib) || mib <= 0) return null;
  return mib;
};

/**
 * Returns true when `mib` whole MiB would exceed `maxPurchasableBytes`.
 * Always returns false when the cap is null (not yet loaded) or the value
 * is non-positive.  Shared by both the preset-package and custom-amount
 * flows so the null-guard and bytes-conversion logic lives in one place.
 */
export const isMibOverCap = (
  mib: number,
  maxPurchasableBytes: bigint | null,
): boolean => {
  if (maxPurchasableBytes === null || mib <= 0) return false;
  return mibToBytes(mib) > maxPurchasableBytes;
};

/**
 * Returns true when a named package (given as MB) would exceed the user's
 * remaining purchase cap.  Thin wrapper around {@link isMibOverCap} that
 * also handles the `undefined` case for optional package sizes.
 */
export const isPackageOverCap = (
  creditsInMB: number | undefined,
  maxPurchasableBytes: bigint | null,
): boolean => {
  if (creditsInMB === undefined) return false;
  return isMibOverCap(creditsInMB, maxPurchasableBytes);
};

/**
 * Computes the number of whole days remaining until `expiresAt`, rounding
 * down so that credits expiring today (< 1 day remaining) return 0.
 * Returns null when `expiresAt` is not provided.
 */
export const daysUntilExpiry = (expiresAt: Date | null): number | null => {
  if (!expiresAt) return null;
  return Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );
};

/**
 * Sums the `uploadBytesRemaining` across a list of wire-format credit batch
 * objects (where bigint fields are serialised as strings) and returns the
 * total as a BigInt.
 */
export const sumExpiringUploadBytes = (
  batches: { uploadBytesRemaining: string }[],
): bigint =>
  batches.reduce((acc, b) => acc + BigInt(b.uploadBytesRemaining), BigInt(0));

// ---------------------------------------------------------------------------
// Batch status classification — shared by CreditHistory and AdminCredits
// ---------------------------------------------------------------------------

export type BatchStatus = 'active' | 'expiring' | 'depleted' | 'expired';

export interface BatchStatusFields {
  expired: boolean;
  uploadBytesRemaining: string;
  expiresAt: string;
}

export const getBatchStatus = (batch: BatchStatusFields): BatchStatus => {
  // Depleted = 0 upload bytes remaining. Download bytes are deliberately
  // ignored — they are not allocated, consumed or enforced anywhere in the
  // app, so upload is the only balance that matters. Same definition as
  // isBatchRefundable and the backend expiry/refund guards.
  // Depleted wins over expired: a fully used-up batch forfeited nothing, so
  // it must never surface as "Expired" (which implies a refund is owed),
  // even if a stale expired flag is set on the row.
  if (BigInt(batch.uploadBytesRemaining) === BigInt(0)) return 'depleted';
  if (batch.expired) return 'expired';
  const days = daysUntilExpiry(new Date(batch.expiresAt));
  if (days !== null && days <= 30) return 'expiring';
  return 'active';
};

// ---------------------------------------------------------------------------
// Refundability — shared by AdminCredits and AdminUserCredits so the two
// admin views cannot drift.
// ---------------------------------------------------------------------------

export interface RefundableFields {
  /** ISO timestamp of the refund action, or null if not yet refunded. */
  refundedAt: string | null;
  uploadBytesRemaining: string;
}

/**
 * A batch is refundable when it has not been refunded yet AND still has
 * unused upload bytes. Depleted batches (0 upload bytes remaining)
 * forfeited nothing, so no refund is ever owed on them — they must not be
 * offered for refund even if a stale `expired` flag is set on the row.
 * Download bytes are deliberately ignored — they are not allocated,
 * consumed or enforced anywhere in the app.
 */
export const isBatchRefundable = (batch: RefundableFields): boolean =>
  batch.refundedAt === null && BigInt(batch.uploadBytesRemaining) > BigInt(0);

export const STATUS_CLASSES: Record<BatchStatus, string> = {
  active:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  expiring:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  depleted: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export const STATUS_LABEL: Record<BatchStatus, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  depleted: 'Depleted',
  expired: 'Expired',
};

// ---------------------------------------------------------------------------
// Payment method
// ---------------------------------------------------------------------------

/**
 * Read a payment method out of untrusted input — the wizard's query-string
 * context, or a wire row from a backend that predates the column.
 *
 * Anything unrecognised — and anything at all that is not exactly the USDC
 * value — reads as AI3. That is not defensive tidiness: the wizard's context is
 * re-hydrated from the query string (see PurchaseCredits/index.tsx), so
 * `?paymentMethod=usdc` or a stale link from a build that spelled it differently
 * arrives here as an arbitrary string. Defaulting the wrong way would put a user
 * into a USDC flow on a deployment that may not sell it, where the honest
 * outcome is the AI3 screen they were always going to get. It is also the
 * column's own default: `intents.payment_method` is NOT NULL DEFAULT
 * 'ai3_native', so a row without one IS an AI3 purchase.
 *
 * The comparison is against PaymentMethod.USDC_ETH rather than a literal so the
 * wire value and this check cannot drift apart.
 */
export const readPaymentMethod = (value: unknown): PaymentMethod =>
  value === PaymentMethod.USDC_ETH
    ? PaymentMethod.USDC_ETH
    : PaymentMethod.AI3_NATIVE;

// ---------------------------------------------------------------------------
// Payment presentation — shared by AdminCredits and AdminUserCredits so the
// two admin views cannot drift.
//
// Every figure below is rendered from the originating intent, because
// purchased_credits records bytes and nothing about the money. Which field
// carries the amount depends on the asset: an AI3 purchase fills
// `paymentAmount` and leaves every token field null, a USDC purchase does the
// reverse. A view that reads only `paymentAmount` therefore shows a USDC
// purchase as though nothing was paid for it.
// ---------------------------------------------------------------------------

/** The intent fields an admin view needs to explain what was paid, and how. */
export interface PaymentFields {
  /** `intents.payment_method`; absent on rows from an older backend. */
  paymentMethod?: string;
  /** AI3 shannons received. Null on a USDC purchase. */
  paymentAmount: string | null;
  /** USDC base units received on chain. Null on an AI3 purchase. */
  tokenAmount: string | null;
  /** USDC base units the user was quoted and agreed to. */
  quotedTokenAmount: string | null;
  /** The AI3 (shannons) that quote was priced for. */
  quotedAi3Shannons: string | null;
  /** Raw oracle USD/AI3 at quote time, scaled by 1e18. */
  usdRateAtCreation: string | null;
}

/** How a purchase was paid, as a column value: asset and chain. */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  [PaymentMethod.AI3_NATIVE]: 'AI3 · Auto EVM',
  [PaymentMethod.USDC_ETH]: 'USDC · Ethereum',
};

/** The asset a refund for this purchase has to be sent in. */
export const PAYMENT_METHOD_ASSET: Record<PaymentMethod, string> = {
  [PaymentMethod.AI3_NATIVE]: 'AI3',
  [PaymentMethod.USDC_ETH]: 'USDC',
};

/** Decimal places every USD/AI3 figure below is rendered at. */
const RATE_DECIMALS = 6;

/**
 * Render an integer already scaled to `places` decimals as a decimal string.
 * All-integer, so a rate near 0.006 does not arrive through a float.
 */
const formatScaled = (digits: bigint, places: number): string => {
  const scale = BigInt(10) ** BigInt(places);
  const negative = digits < BigInt(0);
  const absolute = negative ? -digits : digits;
  const whole = (absolute / scale)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (absolute % scale).toString().padStart(places, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
};

const toBigInt = (value: string | null | undefined): bigint | null => {
  if (value === null || value === undefined || value === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

/**
 * What the user actually paid, in the asset they paid it in.
 *
 * For USDC this is the amount RECEIVED rather than the amount quoted: a
 * payment that differs from its quote is credited pro-rata and filed as
 * AMOUNT_OFF_QUOTE, so the received amount is the one a refund is sized from.
 * `isAmountOffQuote` says when the two differ.
 */
export const formatAmountPaid = (batch: PaymentFields): string => {
  const method = readPaymentMethod(batch.paymentMethod);

  if (method === PaymentMethod.USDC_ETH) {
    const amount =
      toBigInt(batch.tokenAmount) ?? toBigInt(batch.quotedTokenAmount);
    return amount === null ? '—' : `${formatUsdcAmount(amount)} USDC`;
  }

  const shannons = toBigInt(batch.paymentAmount);
  if (shannons === null) return '—';
  try {
    return `${shannonsToAi3(shannons, { trimTrailingZeros: true })} AI3`;
  } catch {
    return '—';
  }
};

/**
 * True when a USDC purchase settled at an amount other than its quote. Not an
 * error — it was credited pro-rata — but it is why the amount on screen may
 * not match the amount the user was asked for, so it is shown rather than
 * silently reconciled.
 */
export const isAmountOffQuote = (batch: PaymentFields): boolean => {
  if (readPaymentMethod(batch.paymentMethod) !== PaymentMethod.USDC_ETH) {
    return false;
  }
  const received = toBigInt(batch.tokenAmount);
  const quoted = toBigInt(batch.quotedTokenAmount);
  return received !== null && quoted !== null && received !== quoted;
};

/** The quoted USDC charge, for the off-quote comparison. Null unless USDC. */
export const formatQuotedAmount = (batch: PaymentFields): string | null => {
  if (readPaymentMethod(batch.paymentMethod) !== PaymentMethod.USDC_ETH) {
    return null;
  }
  const quoted = toBigInt(batch.quotedTokenAmount);
  return quoted === null ? null : `${formatUsdcAmount(quoted)} USDC`;
};

/** The AI3 a USDC charge was quoted FOR — the other half of the rate. */
export const formatQuotedAi3 = (batch: PaymentFields): string | null => {
  const shannons = toBigInt(batch.quotedAi3Shannons);
  if (shannons === null) return null;
  try {
    return `${shannonsToAi3(shannons, { trimTrailingZeros: true })} AI3`;
  } catch {
    return null;
  }
};

/**
 * The USD/AI3 rate the purchase was actually charged at: the quoted USDC
 * divided by the AI3 it was quoted for.
 *
 * This is the rate the user effectively bought at — the quote margin is inside
 * it, because it is inside the amount they paid. `oracleUsdPerAi3` is the raw
 * market rate the quote was derived from, and it is always the lower of the
 * two; neither substitutes for the other.
 *
 * Integer arithmetic throughout. USDC carries 6 decimals and shannons 18, so
 * with the answer rendered at 6 decimals the whole conversion collapses to
 * `quotedTokenAmount * 1e18 / quotedAi3Shannons`.
 */
export const effectiveUsdPerAi3 = (batch: PaymentFields): string | null => {
  const quoted = toBigInt(batch.quotedTokenAmount);
  const shannons = toBigInt(batch.quotedAi3Shannons);
  if (quoted === null || shannons === null || shannons === BigInt(0)) {
    return null;
  }
  return formatScaled(
    (quoted * BigInt(10) ** BigInt(18)) / shannons,
    RATE_DECIMALS,
  );
};

/** The raw oracle USD/AI3 rate at quote time (stored scaled by 1e18). */
export const oracleUsdPerAi3 = (batch: PaymentFields): string | null => {
  const scaled = toBigInt(batch.usdRateAtCreation);
  if (scaled === null) return null;
  return formatScaled(scaled / BigInt(10) ** BigInt(12), RATE_DECIMALS);
};

// ---------------------------------------------------------------------------
// Refund sizing
// ---------------------------------------------------------------------------

export interface RefundSizingFields extends PaymentFields, RefundableFields {
  uploadBytesOriginal: string;
  shannonsPerByte: string;
}

/**
 * Informational pro-rated refund for a set of batches, in the asset they were
 * paid in. Pre-formatted with its unit, because the unit is the point: an AI3
 * figure shown for a USDC purchase is a number an admin would send on the
 * wrong chain.
 *
 * AI3 purchases are sized from the price locked at purchase (unused bytes ×
 * shannons/byte). USDC purchases are sized from the amount actually received,
 * pro-rated by unused bytes — not from the quote, and not by converting bytes
 * at the effective rate: credits were granted from what arrived, so refunding
 * the unused fraction of it is exact even when the payment was off-quote.
 *
 * Already-refunded batches contribute nothing. The transfer itself happens
 * out-of-band and no amount is enforced anywhere.
 */
export const suggestedRefund = (
  batches: RefundSizingFields[],
): string | null => {
  const pending = batches.filter((b) => b.refundedAt === null);
  if (pending.length === 0) return null;

  const method = readPaymentMethod(pending[0].paymentMethod);

  try {
    if (method === PaymentMethod.USDC_ETH) {
      const total = pending.reduce((sum, b) => {
        const paid = toBigInt(b.tokenAmount) ?? toBigInt(b.quotedTokenAmount);
        const original = BigInt(b.uploadBytesOriginal);
        if (paid === null || original === BigInt(0)) return sum;
        return sum + (paid * BigInt(b.uploadBytesRemaining)) / original;
      }, BigInt(0));
      return total === BigInt(0) ? null : `${formatUsdcAmount(total)} USDC`;
    }

    const totalShannons = pending.reduce(
      (sum, b) =>
        sum + BigInt(b.uploadBytesRemaining) * BigInt(b.shannonsPerByte),
      BigInt(0),
    );
    if (totalShannons === BigInt(0)) return null;
    return `${shannonsToAi3(totalShannons, { trimTrailingZeros: true })} AI3`;
  } catch {
    return null;
  }
};
