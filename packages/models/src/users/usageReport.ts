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
    /** An upload split between purchased and free credits counts twice. */
    count: number;
    bytes: string;
    freeTierBytes: string;
    purchasedBytes: string;
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
  /** Credit batches granted in the range, oldest first. */
  purchases: UsagePurchase[];
  /** Null when the range starts before attribution. */
  balance: CreditBalance | null;
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
  deleted: boolean;
  uploadCount: number;
  uploadBytes: string;
  purchasedBytes: string;
  ai3Value: string;
  downloadCount: number;
  downloadBytes: string;
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

/** Purchased upload bytes: opening + granted − consumed − expired − refunded = closing. */
export type CreditBalance = {
  opening: string;
  granted: string;
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
  source: "free_tier" | "purchased";
  bytes: string;
  cid: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
  /** Null when no credit batches are recorded for it. */
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
  downloadBytes: string;
  grantedBytes: string;
};
