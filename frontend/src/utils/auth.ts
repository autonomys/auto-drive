import { getServerSession, type Session } from 'next-auth';
import { getSession } from 'next-auth/react';
import { authOptions } from '../app/api/auth/[...nextauth]/config';

export const getAuthSession = async (): Promise<Session | null> => {
  const internalSession = await (typeof window === 'undefined'
    ? getServerSession(authOptions)
    : getSession());

  if (!internalSession) {
    return null;
  }

  return internalSession;
};
