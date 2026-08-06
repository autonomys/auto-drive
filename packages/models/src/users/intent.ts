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
  // Bytes the user asked to purchase, captured at creation so the size is known
  // before payment rather than reverse-derived from it.
  //
  // Optional because it is genuinely absent in two cases: intents created before
  // the field existed, and AI3 intents created without a size (the endpoint
  // accepts a body-less request, which is what the live frontend sends). The
  // USDC path cannot omit it: a Uniswap quote prices a SPECIFIC size, since
  // slippage is a function of the amount, so there is no size-free USDC-per-byte
  // rate for a sizeless intent to lock.
  //
  // NOT the credits an account received, for either asset. Credits always follow
  // the amount actually paid, divided by the rate locked at creation:
  //
  //   AI3   paymentAmount / shannonsPerByte
  //   USDC  tokenAmount * quotedBytes / quotedTokenAmount
  //
  // The USDC form is division by the locked price per byte
  // (quotedTokenAmount / quotedBytes), multiplied out so the rate is never
  // materialised: as an integer that rate truncates to whole USDC base units per
  // byte, which for any realistic price per byte is 0.
  //
  // So this is an input — the size the quote and the creation-time cap pre-check
  // were computed for — and an audit record of what was asked for. It equals the
  // bytes granted only when the user pays exactly what they were quoted.
  quotedBytes: z.bigint().optional(),
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
  // Together with quotedBytes this IS the locked USDC price per byte, and it is
  // the only rate credits may be derived against: it comes from the executable
  // quote, so the pool swap fee, the price impact of this specific size and the
  // quote margin are all already inside it.
  quotedTokenAmount: z.bigint().optional(),
  // AI3/USD rate at creation, scaled by USD_RATE_SCALE (1e18). Display and
  // reconciliation only — NOT a credit basis.
  //
  // This is the pool's MARGINAL price: what an infinitesimally small trade would
  // get. The user pays the executable quote instead, which additionally carries
  // the swap fee, their own size's price impact and the quote margin. Deriving
  // credits by inverting this rate would hand back all three as free storage —
  // roughly 8% on a $290 purchase against the live pool. Use the rate implied by
  // quotedTokenAmount / quotedBytes.
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
