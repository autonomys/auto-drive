/**
 * Date ranges for usage reports. The backend takes [from, to) in UTC; the UI
 * asks for whole UTC days, `from` through `through` inclusive.
 */

export type UsageDays = { from: string; through: string };

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDay(date);
};

/** The current month so far. */
export const defaultUsageDays = (): UsageDays => {
  const today = utcDay(new Date());
  return { from: `${today.slice(0, 7)}-01`, through: today };
};

/** The first whole UTC day that starts at or after `iso`. */
export const firstDayFrom = (iso: string): string => {
  const date = new Date(iso);
  const day = utcDay(date);
  return date.getTime() === Date.parse(`${day}T00:00:00Z`)
    ? day
    : addDays(day, 1);
};

/** The request range, or null if the days are missing or out of order. */
export const toUsageRange = ({
  from,
  through,
}: UsageDays): { from: string; to: string } | null => {
  if (!from || !through || through < from) return null;
  return { from, to: addDays(through, 1) };
};
