import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export const currentYear = () => {
  return new Date().getFullYear();
};

export const formatDate = (date: string) => {
  const localLocale =
    typeof navigator !== 'undefined' && navigator.language
      ? navigator.language
      : 'en-US';
  return new Date(date).toLocaleDateString(localLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
};

export const utcToLocalRelativeTime = (timestamp: string): string => {
  const now = dayjs();
  const time = dayjs.utc(timestamp).local();
  const diffInSeconds = now.diff(time, 'second');

  if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;
  return time.fromNow(true) + ' ago';
};
