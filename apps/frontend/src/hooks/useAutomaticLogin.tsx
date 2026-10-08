import { useSearchParams } from 'next/navigation';
import { getSession } from 'next-auth/react';
import { AuthProvider, useLogIn } from './useAuth';
import { useEffect } from 'react';
import { CALLBACK_URL_PARAM, sanitizeCallbackUrl } from '@/utils/callbackUrl';

export const useAutomaticLogin = () => {
  const { signIn } = useLogIn();
  const queryParams = useSearchParams();
  const provider = queryParams.get('provider');
  const callbackUrl = sanitizeCallbackUrl(queryParams.get(CALLBACK_URL_PARAM));

  useEffect(() => {
    if (!provider) return;
    // Already signed in: stay on the page rather than re-running OAuth, so a
    // deep link carrying `provider` works the same whether or not the user
    // has a session.
    getSession().then((session) => {
      if (!session) {
        signIn(provider as AuthProvider, {
          callbackUrl: callbackUrl ?? undefined,
        });
      }
    });
  }, [provider, callbackUrl, signIn]);
};
