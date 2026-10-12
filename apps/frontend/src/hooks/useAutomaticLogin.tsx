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
    // Already signed in: skip OAuth and go where sign-in would have landed,
    // so a link carrying `provider` works with or without a session.
    getSession().then((session) => {
      const target = callbackUrl ?? ROUTES.drive(network.id);
      if (session) {
        router.replace(target);
      } else {
        signIn(provider as AuthProvider, { callbackUrl: target });
      }
    });
  }, [provider, callbackUrl, signIn, router, network.id]);
};
