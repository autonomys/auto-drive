/**
 * Whether this deployment is currently selling storage for USDC, and if not,
 * why not.
 *
 * Four independent facts decide it, and they are deliberately not collapsed into
 * one boolean anywhere but at the very end:
 *
 *   - configuration — does this deployment have an Ethereum receiver at all
 *   - the manual gate — a DB-backed admin switch, flipped without a redeploy
 *   - the balance gate — the treasury's un-converted USDC against its cap
 *   - the oracle — can an AI3/USD rate be established at all
 *
 * The oracle's health is per-process in-memory state inside the price oracle, so
 * it is not readable where it is needed: an API replica that has never quoted
 * knows nothing about it. The one process that polls the treasury therefore
 * records it alongside the balance, and every reader gets the same durable
 * answer. It remains enforced independently at quote time — this conjunct exists
 * so the path is not ADVERTISED while every quote would 503.
 */

/**
 * Why USDC is not being accepted. Ordered by precedence: the first one that
 * applies is the one reported, cheapest and most structural first.
 *
 * An enum rather than a message because both the admin dashboard and the
 * frontend branch on it, and a UI that regexes a sentence breaks on the next
 * wording change.
 */
export enum UsdcClosedReason {
  // No Ethereum receiver (or an incomplete Ethereum configuration). Nothing
  // would observe a payment, so nothing may be quoted. Not transient.
  NOT_CONFIGURED = "not_configured",
  // An admin closed the manual gate — or nobody has opened it yet. Latching:
  // no automatic process ever reopens this one.
  MANUAL_OFF = "manual_off",
  // The treasury is holding at or above its cap of un-converted USDC. Clears on
  // its own once a manual conversion brings the balance back below the resume
  // threshold.
  TREASURY_CAP = "treasury_cap",
  // The treasury balance has not been read recently enough to be trusted:
  // nothing has polled yet (a fresh deploy), or the payment worker is down or
  // cannot reach Ethereum. Fails closed — an RPC outage must not become a way
  // to keep selling past the cap.
  BALANCE_UNKNOWN = "balance_unknown",
  // No trustworthy AI3/USD rate: the subgraph is unreachable, or one of the
  // oracle's own guards (thin liquidity, a stale window, a moved market) refuses
  // to price against what it can see. Also covers "nothing has polled the rate
  // yet", which fails closed for the same reason an unknown balance does.
  ORACLE_UNAVAILABLE = "oracle_unavailable",
}

/**
 * The composite answer, as the intent path and /features read it.
 *
 * A discriminated union rather than `{ open: boolean; closedReason?: ... }`, so
 * "there is a reason exactly when the path is closed" is a compiler guarantee
 * instead of a comment — and so no caller needs a non-null assertion to read the
 * reason out of a closed result.
 */
export type UsdcAvailability =
  | { open: true }
  | { open: false; closedReason: UsdcClosedReason };

/** USDC base units per whole USDC. */
export const USDC_DECIMALS = 6;

/**
 * Render a USDC base-unit amount as a human figure ("2,014.00").
 *
 * For operator-facing text only — Slack alerts and the admin dashboard — where
 * "2014000000" is a number nobody reads correctly under pressure. Two decimals
 * because the remaining four are never what a treasury decision turns on;
 * truncated rather than rounded, so a displayed figure is never above the
 * balance actually held.
 *
 * Lives here, in the shared package, because both the backend's alerts and the
 * frontend's dashboard render the same figures — and a money path with two
 * formatters is two things that must agree.
 */
export const formatUsdcBaseUnits = (baseUnits: bigint | string): string => {
  const value = typeof baseUnits === "bigint" ? baseUnits : BigInt(baseUnits);
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const cents = (absolute % scale) / 10n ** BigInt(USDC_DECIMALS - 2);
  const grouped = (absolute / scale)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${cents.toString().padStart(2, "0")}`;
};

/** Where the manual gate's current value comes from. */
export enum UsdcManualGateSource {
  // No row has ever been written; the value is the USDC_PAYMENTS_ENABLED boot
  // default. Reported explicitly because that variable stops mattering the
  // moment an admin flips the switch, and an operator changing it afterwards
  // would otherwise watch nothing happen.
  ENV_DEFAULT = "env_default",
  // An admin wrote it. From here on the env var is inert.
  ADMIN = "admin",
}

/**
 * Everything the admin dashboard needs to explain the state of the USDC path.
 *
 * All token amounts are strings of base units (USDC has 6 decimals), matching
 * how every other bigint crosses this API.
 */
export type UsdcPaymentsStatus = {
  // The composite, exactly as createIntent evaluates it.
  availability: UsdcAvailability;
  // Whether this deployment has a complete Ethereum USDC configuration.
  configured: boolean;
  manualGate: {
    enabled: boolean;
    source: UsdcManualGateSource;
    // Null when the value is still the env default.
    updatedBy: string | null;
    updatedAt: string | null;
  };
  treasury: {
    // Null when nothing has been polled yet.
    balanceBaseUnits: string | null;
    // pause - balance. Negative once the cap is exceeded. Null when unknown.
    headroomBaseUnits: string | null;
    paused: boolean;
    // True when the reading is missing or older than the max-stale window, in
    // which case `paused` is the fail-closed default rather than an observation.
    stale: boolean;
    checkedAt: string | null;
    ageMs: number | null;
    // Null when the configured thresholds cannot be parsed — see thresholdError.
    pauseThresholdBaseUnits: string | null;
    resumeThresholdBaseUnits: string | null;
    maxStaleMs: number;
    checkIntervalMs: number;
    // The addresses whose balances are summed. Always includes the receiver; a
    // sweep to an address outside this set reopens the gate.
    addresses: string[];
    // Set when USDC_TREASURY_ADDRESSES holds something unusable, which closes
    // the gate rather than shrinking the sum. Null when the configuration parses.
    addressError: string | null;
    // Set when the cap or the resume threshold cannot be parsed. The gates job
    // refuses to poll on either, so the path stays closed until it is fixed and
    // the payment worker restarted.
    thresholdError: string | null;
  };
  // The poller's last rate read, not a live one taken to answer this request:
  // health observed by the process that owns it, aged like the balance beside it.
  oracle: {
    // False when unhealthy AND when unknown — `stale` tells those apart.
    healthy: boolean;
    // OracleUnavailableReason when the read failed; null when it succeeded.
    reason: string | null;
    // The rate came from the last-good fallback rather than a fresh read.
    servingStale: boolean;
    // Scaled by USD_RATE_SCALE (1e18), as everywhere else.
    usdPerAi3: string | null;
    // No reading, or one too old to trust — which closes the path.
    stale: boolean;
    checkedAt: string | null;
    ageMs: number | null;
    // The swap window behind the rate, when there was one.
    window: {
      sampleCount: number;
      buyCount: number;
      sellCount: number;
      volumeUsdc: string;
      oneSidedVolumeUsdc: string;
      poolUsdcDepth: string;
      newestSwapAt: string;
      oldestSwapAt: string;
    } | null;
  };
};
