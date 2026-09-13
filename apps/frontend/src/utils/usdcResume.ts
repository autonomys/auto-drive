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
  txHash: string;
  /** The purchase size, so a record from a different purchase is not adopted. */
  sizeMib: number | null;
};

const isRecord = (value: unknown): value is UsdcResumeRecord =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as UsdcResumeRecord).intentId === 'string' &&
  typeof (value as UsdcResumeRecord).txHash === 'string';

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
