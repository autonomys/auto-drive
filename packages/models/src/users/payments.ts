/**
 * Whether this deployment is currently selling storage for USDC, and if not,
 * why not.
 *
 * Three independent facts decide it, and they are deliberately not collapsed
 * into one boolean anywhere but at the very end:
 *
 *   - configuration — does this deployment have an Ethereum receiver at all
 *   - the manual gate — a DB-backed admin switch, flipped without a redeploy
 *   - the balance gate — the treasury's un-converted USDC against its cap
 *
 * The price oracle is the fourth conjunct in the epic's statement of this
 * invariant, and it is deliberately NOT here: its health is per-process
 * in-memory state, so a replica that has never quoted cannot report on it
 * honestly, and consulting it from the public /features endpoint would put a
 * per-query-billed subgraph call behind an unauthenticated route. It stays what
 * it already is — a refusal at quote time, inside createIntent.
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
}

/**
 * The composite answer, as the intent path and /features read it.
 *
 * `open` is the conjunction; `closedReason` says which gate closed it and is
 * undefined exactly when `open` is true.
 */
export type UsdcAvailability = {
  open: boolean;
  closedReason?: UsdcClosedReason;
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
    pauseThresholdBaseUnits: string;
    resumeThresholdBaseUnits: string;
    maxStaleMs: number;
    checkIntervalMs: number;
    // The addresses whose balances are summed. The receiver by default; a sweep
    // to an address outside this set reopens the gate.
    addresses: string[];
  };
  // Read from the process serving this request, which is why the request forces
  // a rate read first: reporting health nobody in this process has observed is
  // worse than reporting none.
  oracle: {
    healthy: boolean;
    // OracleUnavailableReason, when the last attempt failed.
    currentFailureReason: string | null;
    lastFailureReason: string | null;
    lastFailureAt: string | null;
    lastSuccessAt: string | null;
    servingStale: boolean;
    // The window behind the last successful read, when there was one.
    window: {
      usdPerAi3: string;
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
