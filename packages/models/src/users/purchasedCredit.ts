import { z } from "zod";

export const PurchasedCreditSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string(),
  /** The payment intent of a purchase. Null for free credits. */
  intentId: z.string().nullable(),
  /**
   * `purchase`: paid for. `free_one_time`: granted once by an admin.
   * `free_monthly`: a partner's monthly free credits.
   */
  kind: z.enum(["purchase", "free_one_time", "free_monthly"]),
  /** The UTC month (its first day) of monthly free credits, else null. */
  grantPeriod: z.date().nullable(),
  uploadBytesOriginal: z.bigint(),
  uploadBytesRemaining: z.bigint(),
  downloadBytesOriginal: z.bigint(),
  downloadBytesRemaining: z.bigint(),
  purchasedAt: z.date(),
  /** Every purchased credit row has a hard expiry date — never null. */
  expiresAt: z.date(),
  expired: z.boolean(),
  /**
   * Timestamp when an admin recorded an out-of-band refund for this batch,
   * or null if not yet refunded.  Non-null is the canonical source of truth
   * that a refund has occurred — no separate boolean needed.
   * Set by POST /credits/batches/:id/refund, which also zeros remaining bytes.
   */
  refundedAt: z.date().nullable(),
  /**
   * On-chain transaction hash of the AI3 refund transfer. Mandatory when
   * marking a batch as refunded — the refund endpoints reject requests
   * without it. Batches refunded together in one on-chain transaction share
   * the same hash. Null only on rows refunded before this field existed,
   * or rows never refunded.
   */
  refundTxHash: z.string().nullable(),
  /**
   * Upload bytes the refund took back: what the batch had left when it was
   * refunded. Null on unrefunded rows and on rows refunded before this field
   * existed.
   */
  refundedUploadBytes: z.bigint().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PurchasedCredit = z.infer<typeof PurchasedCreditSchema>;

export type PurchasedCreditKind = PurchasedCredit["kind"];

/** Free credits as admins see them: with who granted them and why. */
export type AdminFreeCredit = PurchasedCredit & {
  /** Admin publicId, for one-time free credits. */
  grantedBy: string | null;
  grantReason: string | null;
};

/**
 * Aggregate view of an account's remaining credits across all active
 * (non-expired) rows, purchased and free. Returned by getRemainingCredits().
 */
export type PurchasedCreditSummary = {
  uploadBytesRemaining: bigint;
  /** Sum of upload_bytes_original across all active (non-expired) rows. */
  uploadBytesOriginal: bigint;
  /** Purchased rows only: what the per-account cap is enforced on. */
  purchasedUploadBytesRemaining: bigint;
  purchasedUploadBytesOriginal: bigint;
  /** The soonest expires_at across active purchased rows. */
  purchasedNextExpiryDate: Date | null;
  freeUploadBytesRemaining: bigint;
  downloadBytesRemaining: bigint;
  /** The soonest expires_at across active rows — used for expiry warnings. */
  nextExpiryDate: Date | null;
  activeRowCount: number;
};

/**
 * Tracks whether an interaction was charged against purchased credits or
 * against the account's free / one-off allocation. `purchased` means drawn
 * from credit batches, which include a partner's free credits.
 *
 * Stored in interactions.source. Required so the free-balance calculation
 * (upload_limit - sum(interactions)) only counts free_tier rows and is not
 * distorted by interactions that were already paid for by purchased credits.
 */
export enum InteractionSource {
  FreeTier = "free_tier",
  Purchased = "purchased",
}
