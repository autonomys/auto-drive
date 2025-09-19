import { z } from "zod";

export enum IntentStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  COMPLETED = "completed",
  FAILED = "failed",
}

export const IntentSchema = z.object({
  id: z.string(),
  userPublicId: z.string(),
  status: z.nativeEnum(IntentStatus),
  txHash: z.string().optional(),
  depositAmount: z.bigint().optional(),
  pricePerMB: z.number(),
});

export type Intent = z.infer<typeof IntentSchema>;

export const intentWatchSchema = z.object({
  txHash: z.string(),
});
