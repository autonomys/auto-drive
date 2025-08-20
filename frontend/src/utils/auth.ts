import { type Session } from 'next-auth';
import { authOptions } from 'app/api/auth/[...nextauth]/config';
import { memoizePromise } from '@/utils/async';

const internalGetAuthSession = async (): Promise<Session | null> => {
  const memoizedFrontend = memoizePromise(
    () => import('next-auth/react').then((m) => m.getSession()),
    50,
  );

  const internalSession = await (typeof window === 'undefined'
    ? import('next-auth').then((m) => m.getServerSession(authOptions))
    : memoizedFrontend());

  return internalSession;
};

export const getAuthSession = async (): Promise<Session | null> =>
  internalGetAuthSession();
