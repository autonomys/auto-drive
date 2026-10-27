/**
 * The two ids a submitted USDC payment is tracked by, kept across a reload.
 *
 * Both live in component state, and the panel is unmounted by a refresh, a
 * closed tab or a crashed renderer. Without this, a buyer who reloads while
 * their payment is confirming sees the purchase wizard start over: the payment
 * is on chain and the backend credits it regardless, but the screen that would
 * have said so is gone, and what they are left with is a debited wallet and no
 * acknowledgement. That window is ~72s on Ethereum — six confirmations — which
 * is long enough to be reached by accident.
 *
 * `sessionStorage`, not `localStorage`: this is one purchase in one tab, and a
 * record that outlives the browser session is a record that resurfaces weeks
 * later against an intent nobody remembers.
 *
 * Pure and separate from the panel so it can be tested without React, and so
 * every access is wrapped once — storage throws outright in a private window or
 * with site data blocked, and a purchase must not be lost to a bookkeeping
 * convenience failing.
 */

const KEY = 'auto-drive:usdc-purchase-in-flight';

export type UsdcResumeRecord = {
  intentId: string;
  txHash?: string;
  /** The server knows a payment exists but has not supplied its hash. */
  paymentKnown?: boolean;
  /** Wallet batch handle, saved before requesting approval so a lost response
   * or reload can be recovered without sending the payment again. */
  batchId?: string;
  payer?: string;
  /** Original quote deadline, for warnings while a batch is pending. */
  expiresAt?: string;
  /** The purchase size, so a record from a different purchase is not adopted. */
  sizeMib: number | null;
  /**
   * What the payment target said when the payment was made.
   *
   * Stored because the panel's other source for these is unavailable exactly
   * when they are needed. `useUsdcAvailability` only asks for the target while
   * `payWithUsdc` is true, so a session resumed after the gate has closed has
   * none — and each of these then falls back to something that misreports a
   * payment which is settling perfectly well:
   *
   *   - `chainId`: unpinned, `useTransactionConfirmation` follows the connected
   *     chain, which the flow has just invited the buyer to switch back to Auto
   *     EVM. The Ethereum receipt is never seen and the payment reads as lost.
   *   - `settleGraceMs`: falls back to a compiled constant, which is the exact
   *     thing serving it was meant to prevent — a build holding its own copy
   *     starts calling credited purchases expired the day an operator changes
   *     the interval behind it.
   *   - `confirmations`: only the progress bar, but it should count to the same
   *     number it started with.
   *
   * All optional, because a record written by an older build has none of them.
   */
  chainId?: number;
  confirmations?: number;
  settleGraceMs?: number;
};

const isRecord = (value: unknown): value is UsdcResumeRecord =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as UsdcResumeRecord).intentId === 'string' &&
  (typeof (value as UsdcResumeRecord).txHash === 'string' ||
    ((value as UsdcResumeRecord).paymentKnown === true &&
      typeof (value as UsdcResumeRecord).chainId === 'number') ||
    (typeof (value as UsdcResumeRecord).batchId === 'string' &&
      typeof (value as UsdcResumeRecord).payer === 'string' &&
      typeof (value as UsdcResumeRecord).chainId === 'number'));

export const saveUsdcResume = (record: UsdcResumeRecord): void => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Nothing to do and nothing to report: the payment is unaffected, and the
    // only cost is that a reload will not pick it back up.
  }
};

/**
 * The record for THIS purchase, if there is one.
 *
 * `sizeMib` has to agree. A buyer who reloads and then picks a different amount
 * must not have the previous purchase's confirmation screen attached to it —
 * that would show a hash for a payment that has nothing to do with what they
 * are now buying.
 */
export const readUsdcResume = (
  sizeMib: number | null,
): UsdcResumeRecord | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.sizeMib !== sizeMib) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const clearUsdcResume = (): void => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // See saveUsdcResume.
  }
};
