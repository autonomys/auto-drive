import { getServerSession, type Session } from 'next-auth';
import { getSession } from 'next-auth/react';

export const getAuthSession = async (): Promise<Session | null> => {
  const internalSession = await (typeof window === 'undefined'
    ? getServerSession()
    : getSession());

  if (!internalSession) {
    return null;
  }

  return internalSession;
};

export const isAuthenticated = async (): Promise<boolean> => {
  const internalSession = await (typeof window === 'undefined'
    ? getServerSession()
    : getSession());

  return !!internalSession;
};
