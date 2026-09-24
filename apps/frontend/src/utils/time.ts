import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

export const currentYear = () => {
  return new Date().getFullYear();
};

export const formatDate = (date: string) => {
  if (!date || !dayjs(date).isValid()) return 'N/A';
  const localDate = dayjs.utc(date).local();
  return localDate.format('MMM D, YYYY, h:mm A');
};

export const formatLocalDate = (date: string) => {
  if (!date || !dayjs(date).isValid()) return 'N/A';
  const localDate = dayjs.utc(date).local();
  return `${localDate.format('MMM D, YYYY, h:mm A')}`;
};

export const utcToLocalRelativeTime = (timestamp: string): string => {
  if (!timestamp || !dayjs(timestamp).isValid()) return 'N/A';
  const now = dayjs();
  const time = dayjs.utc(timestamp).local();
  const diffInSeconds = now.diff(time, 'second');

  if (diffInSeconds === 0) {
    return 'just now';
  } else if (diffInSeconds > 0) {
    if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;
    return time.fromNow(true) + ' ago';
  } else {
    const absDiff = Math.abs(diffInSeconds);
    if (absDiff < 60) return `${absDiff} seconds from now`;
    return time.fromNow(true) + ' from now';
  }
};

export const formatDateWithTimezone = (date: string) => {
  if (!date || !dayjs(date).isValid()) return 'N/A';
  const localDate = dayjs.utc(date).local();
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${localDate.format('MMM D, YYYY, h:mm A')} (${tzName})`;
};
