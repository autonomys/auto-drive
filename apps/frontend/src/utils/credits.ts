/**
 * Pure utility functions for credit cap and expiry calculations.
 * Extracted so they can be unit-tested without a React environment.
 */

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
  const bytes = BigInt(mib) * BigInt(1024 * 1024);
  return bytes > maxPurchasableBytes;
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
  if (batch.expired) return 'expired';
  if (BigInt(batch.uploadBytesRemaining) === BigInt(0)) return 'depleted';
  const days = daysUntilExpiry(new Date(batch.expiresAt));
  if (days !== null && days <= 30) return 'expiring';
  return 'active';
};

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
