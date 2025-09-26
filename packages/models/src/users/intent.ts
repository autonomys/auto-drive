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
  paymentAmount: z.bigint().optional(),
  shannonsPerByte: z.bigint(),
});

export type Intent = z.infer<typeof IntentSchema>;

export const intentCreationSchema = z.object({
  expiresAt: z
    .date()
    .refine((date) => date > new Date(Date.now() + 1000 * 60 * 60), {
      message: "Expires at must be at least 1 hour from now",
    }),
});

export type IntentCreation = z.infer<typeof intentCreationSchema>;

export const intentWatchSchema = z.object({
  txHash: z.string(),
});
