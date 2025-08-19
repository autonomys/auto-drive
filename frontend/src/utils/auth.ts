import { type Session } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from 'app/api/auth/[...nextauth]/config';
import { memoizePromise } from '@/utils/async';

const memoizedFrontend = memoizePromise(
  () => import('next-auth/react').then((m) => m.getSession()),
  500,
);

const internalGetAuthSession = async (): Promise<Session | null> => {
  const internalSession = await (typeof window === 'undefined'
    ? import('next-auth').then((m) => m.getServerSession(authOptions))
    : memoizedFrontend());

  if (!internalSession) {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    typeof window === 'undefined'
      ? redirect('/')
      : (window.location.href = '/');
    return null;
  }

  return internalSession;
};

export const getAuthSession = async (): Promise<Session | null> =>
  internalGetAuthSession();
