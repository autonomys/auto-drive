import { z } from "zod";

export enum IntentStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  COMPLETED = "completed",
  FAILED = "failed",
  EXPIRED = "expired",
  // Payment was confirmed on-chain but the user's purchased credit balance
  // is at or above the per-user cap, so credits could not be granted.
  // This is a terminal state — the polling loop will not retry it.
  // An admin must review and either adjust the cap + reprocess, or arrange
  // an out-of-band refund.
  OVER_CAP = "over_cap",
}

export const IntentSchema = z.object({
  id: z.string(),
  userPublicId: z.string(),
  status: z.nativeEnum(IntentStatus),
  txHash: z.string().optional(),
  paymentAmount: z.bigint().optional(),
  shannonsPerByte: z.bigint(),
  // Price-lock window: set at creation, intent is rejected after this time.
  // NULL for intents created before this feature was introduced.
  expiresAt: z.date().optional(),
});

export type Intent = z.infer<typeof IntentSchema>;

export const intentCreationSchema = z.object({
  expiresAt: z
    .string()
    .transform((date) => new Date(date))
    .refine((date) => date > new Date(Date.now() + 1000 * 60 * 60), {
      message: "Expires at must be at least 1 hour from now",
    }),
});

export type IntentCreation = z.infer<typeof intentCreationSchema>;

export const intentWatchSchema = z.object({
  txHash: z.string(),
});
