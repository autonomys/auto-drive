import { type Session } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from 'app/api/auth/[...nextauth]/config';

export const getAuthSession = async (): Promise<Session | null> => {
  const internalSession = await (typeof window === 'undefined'
    ? import('next-auth').then((m) => m.getServerSession(authOptions))
    : import('next-auth/react').then((m) => m.getSession()));

  if (!internalSession) {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    typeof window === 'undefined'
      ? redirect('/')
      : (window.location.href = '/');
    return null;
  }

  return internalSession;
};
