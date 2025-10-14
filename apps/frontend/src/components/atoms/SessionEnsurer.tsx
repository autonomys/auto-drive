import { SessionContext } from 'next-auth/react';
import { useContext, useEffect } from 'react';
import { useUserStore } from '../../globalStates/user';
import { useNetwork } from '../../contexts/network';
import { AuthService } from '../../services/auth/auth';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

export const SessionEnsurer = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const session = useContext(SessionContext);
  const setUser = useUserStore(({ setUser }) => setUser);
  const setFeatures = useUserStore(({ setFeatures }) => setFeatures);
  const setAccount = useUserStore((m) => m.setAccount);
  const { api } = useNetwork();

  useEffect(() => {
    if (session === undefined) return;

    if (session.data === null) {
      setUser(null);
    } else {
      AuthService.getMe().then((user) => {
        if (user.onboarded) {
          setUser(user);
        } else {
          setUser(null);
          router.push('/onboarding');
        }
      });
    }
  }, [api, router, session, session?.data, setAccount, setUser]);

  const { data: account } = useQuery({
    queryKey: ['account'],
    queryFn: () => api.getAccount(),
    enabled: !!session?.data,
  });

  const { data: features } = useQuery({
    queryKey: ['features'],
    queryFn: () => api.getFeatures(),
    enabled: !!session?.data,
  });

  useEffect(() => {
    if (account) setAccount(account);
  }, [account, setAccount]);

  useEffect(() => {
    if (features) setFeatures(features);
  }, [features, setFeatures]);

  if (session === undefined) {
    // TODO: Add a loading state
    return <div>Loading...</div>;
  }

  return <>{children}</>;
};
