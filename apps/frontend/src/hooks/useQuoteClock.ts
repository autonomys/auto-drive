import { useEffect, useState } from 'react';

/** Refresh immediately when a sleeping/backgrounded tab returns to checkout. */
export const useQuoteClock = (expiresAt: Date | null): number => {
  const [now, setNow] = useState(() => Date.now());
  const deadline = expiresAt?.getTime();
  useEffect(() => {
    if (deadline === undefined) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, 1000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [deadline]);
  return now;
};
