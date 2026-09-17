/**
 * Pure utility functions for credit cap and expiry calculations.
 * Extracted so they can be unit-tested without a React environment.
 */

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
