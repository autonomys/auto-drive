import { useSearchParams } from 'next/navigation';
import { AuthProvider, useLogIn } from './useAuth';
import { useEffect } from 'react';

export const useAutomaticLogin = () => {
  const { signIn } = useLogIn();
  const queryParams = useSearchParams();
  const provider = queryParams.get('provider');

  useEffect(() => {
    if (provider) {
      signIn(provider as AuthProvider);
    }
  }, [provider, signIn]);
};
