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
  const localDate = dayjs.utc(date).local();
  return localDate.format('MMM D, YYYY, h:mm A');
};

export const formatLocalDate = (date: string) => {
  const localDate = dayjs.utc(date).local();
  return `${localDate.format('MMM D, YYYY, h:mm A')}`;
};

export const utcToLocalRelativeTime = (timestamp: string): string => {
  const now = dayjs();
  const time = dayjs.utc(timestamp).local();
  const diffInSeconds = now.diff(time, 'second');

  if (diffInSeconds > 0) {
    if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;
    return time.fromNow(true) + ' ago';
  } else {
    if (diffInSeconds > -60) return `${diffInSeconds} seconds from now`;
    return time.fromNow(true) + ' from now';
  }
};

export const formatDateWithTimezone = (date: string) => {
  const localDate = dayjs.utc(date).local();
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${localDate.format('MMM D, YYYY, h:mm A')} (${tzName})`;
};
