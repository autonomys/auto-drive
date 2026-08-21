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

/**
 * How an intent is paid. The payment asset is a first-class concept so new
 * tokens/chains can be added as configuration rather than schema changes.
 *
 * Persisted in `intents.payment_method` (NOT NULL, defaults to AI3_NATIVE for
 * rows created before USDC support), so it is always present on a stored intent.
 */
export enum PaymentMethod {
  // Native AI3 on Auto EVM — the original PayWithAI3 flow.
  AI3_NATIVE = "ai3_native",
  // USDC (ERC20) on Ethereum mainnet — deferred-conversion flow.
  USDC_ETH = "usdc_eth",
}

/**
 * Fixed-point scale for `usdRateAtCreation`. The AI3/USD rate is stored as an
 * integer scaled by 1e18 (e.g. 0.0064 USD/AI3 -> 6_400_000_000_000_000n) so it
 * can be carried as a bigint and used in integer-only quote math, matching how
 * shannonsPerByte / paymentAmount are handled. Divide by USD_RATE_SCALE to
 * recover the human-readable USD-per-AI3 value.
 */
export const USD_RATE_DECIMALS = 18;
export const USD_RATE_SCALE = 10n ** 18n;

export const IntentSchema = z.object({
  id: z.string(),
  userPublicId: z.string(),
  status: z.nativeEnum(IntentStatus),
  // Payment asset for this intent. NOT NULL in the DB with a default of
  // AI3_NATIVE, but optional here (like expiresAt/fromAddress) so the type stays
  // additive and back-compatible until the column and its read/write wiring land
  // in later steps of this epic; treat a missing value as AI3_NATIVE.
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  txHash: z.string().optional(),
  paymentAmount: z.bigint().optional(),
  shannonsPerByte: z.bigint(),
  // Price-lock window: set at creation, intent is rejected after this time.
  // NULL for intents created before this feature was introduced.
  expiresAt: z.date().optional(),
  // EVM wallet address that sent the on-chain payment. For AI3_NATIVE this is
  // the tx sender (TransactionReceipt.from); for USDC_ETH it is the `payer`
  // field of the IntentTokenPaymentReceived event (ERC20 payments can be
  // relayed). NULL for intents confirmed before this field was introduced.
  fromAddress: z.string().optional(),
  // --- Token-payment fields: set for USDC_ETH only; NULL for AI3_NATIVE ---
  // Raw on-chain token amount actually received, in the token's smallest unit
  // (USDC has 6 decimals). Set by the payment manager on confirmation.
  tokenAmount: z.bigint().optional(),
  // Token amount quoted to the user at creation, in the token's smallest unit.
  // Nothing writes it yet; #747 does, when it prices a USDC intent.
  //
  // This is what the user was ASKED to pay, so it is margin-inclusive and
  // rounded up — it must never sit below what the purchase costs. It is
  // therefore not what credits are derived from either: those follow the amount
  // actually received (paymentAmount / shannonsPerByte), which may be more or
  // less than this.
  quotedTokenAmount: z.bigint().optional(),
  // AI3/USD rate at creation, scaled by USD_RATE_SCALE (1e18). Display,
  // reporting and oracle reconciliation — NOT the rate credits convert at.
  //
  // This is the RAW rate the oracle reported, whatever its source at the time
  // (the source has already changed twice; see #746). The user is charged that
  // rate plus USD_QUOTE_MARGIN, so converting a received payment back to AI3 at
  // this one returns the margin as free storage on every purchase — the whole
  // margin, exactly, since a rate is a scalar and the error scales with the
  // amount.
  //
  // It stays raw on purpose, so it remains comparable to the market and usable
  // for reconciliation. The consequence is that the USDC credit path has to
  // persist its own margin-inclusive effective rate (see #747), and that no
  // other field here can stand in for it: this one is short by the margin, and
  // quotedTokenAmount above is an amount for one specific purchase rather than a
  // rate.
  usdRateAtCreation: z.bigint().optional(),
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
