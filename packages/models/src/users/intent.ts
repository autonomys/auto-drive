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
  // `usdRateAtCreation` applied to `quotedAi3Shannons`, plus USD_QUOTE_MARGIN.
  //
  // The fee and price impact the pool charged are inside it, but by way of the
  // rate rather than this purchase: the rate averages realized fills, and those
  // fills paid both. This purchase adds no impact of its own, because the
  // treasury no longer swaps per intent.
  //
  // This is what the user was ASKED to pay, so it is margin-inclusive and
  // rounded up — it must never sit below what the purchase costs. It is
  // therefore not what credits are derived from either: those follow the amount
  // actually received, which may be more or less than this.
  //
  // One half of the effective rate. `quotedAi3Shannons` is the other half.
  quotedTokenAmount: z.bigint().optional(),
  // The AI3 amount (shannons) `quotedTokenAmount` was quoted FOR — the
  // requested byte count times `shannonsPerByte`. Not something the oracle is
  // asked about: it reports one size-independent rate, and this is the amount
  // that rate is applied to.
  //
  // Paired with `quotedTokenAmount` this IS the effective rate the user was
  // charged at, and it is the pair rather than a rate because a rate here would
  // have to be a rounded ratio: USDC carries 6 decimals against byte counts near
  // 1e11, so USDC-per-byte is ~0.0027 base units and only survives as an integer
  // if it is scaled — at which point it no longer round-trips the quote exactly.
  // Two exact integers do:
  //
  //   bytes = tokenAmount * quotedAi3Shannons
  //             / quotedTokenAmount / shannonsPerByte
  //
  // When the user pays exactly what was quoted the ratio cancels and the result
  // is the requested size exactly. NULL for AI3_NATIVE.
  quotedAi3Shannons: z.bigint().optional(),
  // AI3/USD rate at creation, scaled by USD_RATE_SCALE (1e18). Display,
  // reporting and oracle reconciliation — NOT the rate credits convert at.
  //
  // This is the RAW rate the oracle reported: a volume-weighted average of the
  // pool's recent realized fills (#746). The user is charged that rate plus
  // USD_QUOTE_MARGIN, so converting a received payment back to AI3 at this one
  // hands the margin back as free storage on every purchase — the whole margin,
  // exactly, since a rate is a scalar and the error scales with the amount —
  // and grants more bytes than the pre-payment cap check was run against.
  //
  // It stays raw on purpose, so it remains comparable to the market and usable
  // for reconciliation. The rate credits actually convert at is the
  // `quotedTokenAmount` / `quotedAi3Shannons` pair above, which is why that pair
  // is persisted: neither field here can stand in for it. This one is short by
  // the margin, and `quotedTokenAmount` alone is an amount for one specific
  // purchase rather than a rate.
  usdRateAtCreation: z.bigint().optional(),
});

export type Intent = z.infer<typeof IntentSchema>;

/**
 * Why an on-chain payment could not be attached to the intent it named.
 *
 * Both receivers take any `intentId` from anyone — `payIntent(bytes32)` on Auto
 * EVM and `payIntentWithToken(bytes32, uint256)` on Ethereum — so a payment can
 * name an intent that does not exist, or one denominated in the other asset.
 * Neither is resolvable in code: the money has moved and the only remaining
 * question is who it belongs to.
 */
export enum IntentMispaymentReason {
  // The intent id in the event matches no row.
  UNKNOWN_INTENT = "unknown_intent",
  // The row exists but is denominated in the other asset — AI3 sent to a USDC
  // intent, or vice versa.
  ASSET_MISMATCH = "asset_mismatch",
}

/**
 * A payment that arrived and was refused, recorded so it can be resolved.
 *
 * Refusing is the right call — confirming a mispayment strands the intent and
 * makes the idempotency guard discard the user's real payment when it lands —
 * but a refusal that exists only as a log line leaves an irreversible on-chain
 * transfer with nothing durable pointing at it. This row is what an admin works
 * from: which intent was named, what actually arrived, who sent it, and the
 * transaction to look it up by.
 *
 * Deliberately NOT foreign-keyed to `intents`: the UNKNOWN_INTENT case has no
 * row to point at, and that is precisely the case with the least other evidence.
 */
export type IntentMispayment = {
  id: string;
  // The id named by the on-chain event. Not necessarily an existing intent.
  intentId: string;
  reason: IntentMispaymentReason;
  // What the named intent was denominated in; absent for UNKNOWN_INTENT.
  expectedPaymentMethod?: PaymentMethod;
  // Whichever the watcher reported. Exactly one is set — which one is itself
  // the evidence of what went wrong.
  paymentAmount?: bigint;
  tokenAmount?: bigint;
  fromAddress?: string;
  txHash?: string;
  createdAt: Date;
};

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
