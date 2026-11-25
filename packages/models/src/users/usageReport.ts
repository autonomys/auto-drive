import { PaymentMethod } from "./intent.js";

/*
 * Usage reports (#893). Byte counts and amounts are decimal strings, since
 * they can exceed Number.MAX_SAFE_INTEGER. AI3 amounts are in shannons
 * (10^-18 AI3), USDC amounts in base units (10^-6 USDC). Times are ISO 8601,
 * UTC. A range includes `from` and excludes `to`.
 */

export type UsageReport = {
  accountId: string;
  from: string;
  /** The requested end, or the time of the report if that is earlier. */
  to: string;
  /**
   * When uploads started recording their API key and credit batches, or null
   * if that has not happened. See `UsageByApiKey.kind` and `balance`.
   */
  attributionStart: string | null;
  uploads: {
    /**
     * An upload split between sources (free tier, purchased credits, free
     * credits) counts once per source.
     */
    count: number;
    bytes: string;
    freeTierBytes: string;
    /** Bytes paid with purchased credits, including `unattributedBytes`. */
    purchasedBytes: string;
    /** Bytes paid with free credits an admin granted. They have no AI3 value. */
    freeCreditBytes: string;
    /**
     * Purchased bytes with no record of the batches they came from, i.e.
     * uploads from before attribution. They have no AI3 value.
     */
    unattributedBytes: string;
    /** Purchased bytes valued at the price of the batches they came from. */
    ai3Value: string;
  };
  downloads: {
    count: number;
    bytes: string;
  };
  /** Sums to `uploads` and `downloads`. */
  apiKeys: UsageByApiKey[];
  /** Sums to `uploads`. Downloads carry no customer reference. */
  customerReferences: UsageByCustomerReference[];
  /** Credit batches purchased in the range, oldest first. */
  purchases: UsagePurchase[];
  /** Free credit batches granted in the range, oldest first. */
  freeCredits: UsageFreeCredit[];
  /**
   * What changed the free credit balance in the range, apart from uploads,
   * newest first: grants, monthly issues, changes to the monthly amount and
   * credits that expired unused.
   */
  freeCreditChanges: UsageFreeCreditChange[];
  /**
   * Purchased credits only. Null when the range starts before attribution.
   */
  balance: CreditBalance | null;
  /**
   * Free credits only; `refunded` is always 0. Null when the range starts
   * before attribution.
   */
  freeCreditBalance: CreditBalance | null;
};

export type UsageByApiKey = {
  /**
   * `apiKey`: made with the key `apiKeyId`. `session`: made in the web app.
   * `unattributed`: made before attribution, so it is unknown which.
   */
  kind: "apiKey" | "session" | "unattributed";
  apiKeyId: string | null;
  /** The key's name, null if it has none or for the other kinds. */
  name: string | null;
  /**
   * Whose key it is: the organisation's, or one member's own. Null for the
   * other kinds, or when the auth service did not say.
   */
  owner: "organization" | "member" | null;
  /** The member's public ID for a member's key, else null. */
  ownerPublicId: string | null;
  deleted: boolean;
  uploadCount: number;
  uploadBytes: string;
  purchasedBytes: string;
  freeCreditBytes: string;
  ai3Value: string;
  downloadCount: number;
  downloadBytes: string;
};

/** Uploads tagged with one customer reference, or with none. */
export type UsageByCustomerReference = {
  /** Null for uploads made without a reference. */
  customerReference: string | null;
  uploadCount: number;
  uploadBytes: string;
  purchasedBytes: string;
  freeCreditBytes: string;
  ai3Value: string;
};

export type UsagePurchase = {
  batchId: string;
  intentId: string;
  /** Public ID of the member who paid. */
  buyer: string;
  grantedAt: string;
  paymentMethod: PaymentMethod;
  /** AI3 shannons received, for an AI3 purchase. */
  paymentAmount: string | null;
  /** USDC base units received, for a USDC purchase. */
  tokenAmount: string | null;
  /**
   * The USDC quote and the AI3 it was priced for: together, the rate a USDC
   * purchase was charged at.
   */
  quotedTokenAmount: string | null;
  quotedAi3Shannons: string | null;
  shannonsPerByte: string;
  bytes: string;
  expiresAt: string;
  txHash: string | null;
  fromAddress: string | null;
  refundedAt: string | null;
  refundTxHash: string | null;
  /** Null if the batch is not refunded or was refunded before this was recorded. */
  refundedBytes: string | null;
};

/** A free credit batch an admin granted. */
export type UsageFreeCredit = {
  batchId: string;
  kind: "free_one_time" | "free_monthly";
  grantedAt: string;
  /** The UTC month of monthly free credits, as its first day (YYYY-MM-DD). */
  period: string | null;
  bytes: string;
  expiresAt: string;
  /** Admins only: who granted one-time free credits, and why. */
  grantedBy?: string | null;
  reason?: string | null;
};

/**
 * A change to an account's free credits.
 *
 * - `grant`: one-time free credits an admin granted.
 * - `monthly`: a month's free credits, issued at the monthly amount.
 * - `monthly_change`: an admin changed the monthly amount. The month's
 *   credits left end and the new amount less what the month has used takes
 *   their place, so `bytes` is the difference: positive when raised,
 *   negative when lowered.
 * - `expiry`: credits that ended unused.
 */
export type UsageFreeCreditChange = {
  at: string;
  type: "grant" | "monthly" | "monthly_change" | "expiry";
  /** Bytes added (positive) or taken away (negative). */
  bytes: string;
  /** The UTC month of monthly free credits, as its first day (YYYY-MM-DD). */
  period: string | null;
  /** When the credits this change added expire; null if it added none. */
  expiresAt: string | null;
  /** `monthly_change` only: the monthly amount before and after. */
  monthlyBefore: string | null;
  monthlyAfter: string | null;
  /** Admins only: who granted the credits or changed the amount, and why. */
  by?: string | null;
  reason?: string | null;
};

/**
 * Upload bytes in one kind of credit batch, purchased or free: opening +
 * granted + adjusted − consumed − expired − refunded = closing.
 */
export type CreditBalance = {
  opening: string;
  granted: string;
  /**
   * Free credits only, else 0: what changes to the monthly amount added
   * (positive) or took away (negative). Credits they ended are counted here,
   * not as expired, and credits they issued here, not as granted.
   */
  adjusted: string;
  consumed: string;
  expired: string;
  refunded: string;
  closing: string;
};

/** One interaction, for the detail export. */
export type UsageInteraction = {
  id: string;
  createdAt: string;
  type: "upload" | "download";
  source: "free_tier" | "purchased" | "free_credits";
  bytes: string;
  cid: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
  customerReference: string | null;
  /** Null when no credit batches are recorded for it. 0 for free credits. */
  ai3Value: string | null;
};

/** One account's headline figures, for the admin list. */
export type AccountUsageSummary = {
  accountId: string;
  organizationId: string;
  organizationName: string | null;
  isPartner: boolean;
  uploadCount: number;
  uploadBytes: string;
  ai3Value: string;
  /** Bytes uploaded with free credits. */
  freeCreditBytes: string;
  downloadBytes: string;
  /** Bytes of credits purchased in the range. */
  grantedBytes: string;
  /** Bytes of free credits granted in the range. */
  freeCreditsGrantedBytes: string;
};
