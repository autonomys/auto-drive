import { z } from "zod";

export const PurchasedCreditSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string(),
  intentId: z.string(),
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
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PurchasedCredit = z.infer<typeof PurchasedCreditSchema>;

/**
 * Aggregate view of an account's remaining purchased credits across all
 * active (non-expired) rows. Returned by getRemainingPurchasedCredits()
 * and used by the per-user cap enforcement check.
 */
export type PurchasedCreditSummary = {
  uploadBytesRemaining: bigint;
  downloadBytesRemaining: bigint;
  /** The soonest expires_at across active rows — used for expiry warnings. */
  nextExpiryDate: Date | null;
  activeRowCount: number;
};

/**
 * Tracks whether an interaction was charged against purchased credits or
 * against the account's free / one-off allocation.
 *
 * Stored in interactions.source. Required so the free-balance calculation
 * (upload_limit - sum(interactions)) only counts free_tier rows and is not
 * distorted by interactions that were already paid for by purchased credits.
 */
export enum InteractionSource {
  FreeTier = "free_tier",
  Purchased = "purchased",
}
