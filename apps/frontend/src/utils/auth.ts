import { type Session } from 'next-auth';
import { authOptions } from 'app/api/auth/[...nextauth]/config';
import { memoizePromise } from '@/utils/async';

// 30s TTL — collapses the storm of concurrent /api/auth/session calls into one.
const memoizedFrontend = memoizePromise(
  () => import('next-auth/react').then((m) => m.getSession()),
  30_000,
);

// Call on sign-out/sign-in so subsequent API calls don't use stale credentials.
export const clearSessionCache = () => memoizedFrontend.invalidate();

const internalGetAuthSession = async (): Promise<Session | null> => {
  const internalSession = await (typeof window === 'undefined'
    ? import('next-auth').then((m) => m.getServerSession(authOptions))
    : memoizedFrontend());

  return internalSession;
};

export const getAuthSession = async (): Promise<Session | null> =>
  internalGetAuthSession();
