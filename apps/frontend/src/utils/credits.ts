/**
 * Pure utility functions for credit cap and expiry calculations.
 * Extracted so they can be unit-tested without a React environment.
 */

/**
 * Returns true when a named package (given as MB) would exceed the user's
 * remaining purchase cap.  Always returns false when maxPurchasableBytes is
 * null (cap data not yet loaded) so the UI does not block free-tier users.
 */
export const isPackageOverCap = (
  creditsInMB: number | undefined,
  maxPurchasableBytes: bigint | null,
): boolean => {
  if (maxPurchasableBytes === null || creditsInMB === undefined) return false;
  const packageBytes = BigInt(creditsInMB) * BigInt(1024 * 1024);
  return packageBytes > maxPurchasableBytes;
};

/**
 * Computes the number of days remaining until `expiresAt`, rounding up to the
 * nearest whole day.  Returns null when `expiresAt` is not provided.
 */
export const daysUntilExpiry = (expiresAt: Date | null): number | null => {
  if (!expiresAt) return null;
  return Math.ceil(
    (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
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
