import { type Session } from 'next-auth';
import { authOptions } from 'app/api/auth/[...nextauth]/config';
import { memoizePromise } from '@/utils/async';

// 30s TTL — collapses the storm of concurrent /api/auth/session calls into one.
// Trade-off: after sign-out (or sign-in as a different user), API calls made via
// getAuthSession() may use stale credentials for up to 30s. The UI itself updates
// immediately (SessionProvider doesn't use this cache). If this becomes a problem,
// add a clearSessionCache() that resets sharedPromise on sign-out/sign-in events.
const memoizedFrontend = memoizePromise(
  () => import('next-auth/react').then((m) => m.getSession()),
  30_000,
);

const internalGetAuthSession = async (): Promise<Session | null> => {
  const internalSession = await (typeof window === 'undefined'
    ? import('next-auth').then((m) => m.getServerSession(authOptions))
    : memoizedFrontend());

  return internalSession;
};

export const getAuthSession = async (): Promise<Session | null> =>
  internalGetAuthSession();
