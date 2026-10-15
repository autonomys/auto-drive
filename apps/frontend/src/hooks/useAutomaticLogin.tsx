import { useRouter, useSearchParams } from 'next/navigation';
import { getSession } from 'next-auth/react';
import { ROUTES } from '@auto-drive/ui';
import { AuthProvider, useLogIn } from './useAuth';
import { useEffect } from 'react';
import { CALLBACK_URL_PARAM, sanitizeCallbackUrl } from '@/utils/callbackUrl';
import { useNetwork } from '@/contexts/network';

export const useAutomaticLogin = () => {
  const { signIn } = useLogIn();
  const router = useRouter();
  const { network } = useNetwork();
  const queryParams = useSearchParams();
  const provider = queryParams.get('provider');
  const callbackUrl = sanitizeCallbackUrl(queryParams.get(CALLBACK_URL_PARAM));

  useEffect(() => {
    if (!provider) return;
    // Already signed in: skip OAuth. Only move on when the link names a
    // destination; otherwise stay on the current page (e.g. the extension's
    // `/developers?newKey=…&provider=…` link opened with a session).
    getSession().then((session) => {
      if (session) {
        if (callbackUrl) router.replace(callbackUrl);
        return;
      }
      signIn(provider as AuthProvider, {
        callbackUrl: callbackUrl ?? ROUTES.drive(network.id),
      });
    });
  }, [provider, callbackUrl, signIn, router, network.id]);
};
