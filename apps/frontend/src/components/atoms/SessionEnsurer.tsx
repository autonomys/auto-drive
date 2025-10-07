import { SessionContext } from 'next-auth/react';
import { useContext, useEffect } from 'react';
import { useUserStore } from '../../globalStates/user';
import { useNetwork } from '../../contexts/network';
import { AuthService } from '../../services/auth/auth';
import { useRouter } from 'next/navigation';

export const SessionEnsurer = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const session = useContext(SessionContext);
  const setUser = useUserStore(({ setUser }) => setUser);
  const user = useUserStore(({ user }) => user);
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

  useEffect(() => {
    api.getAccount().then((account) => {
      setAccount(account);
    });
  }, [api, setAccount]);

  useEffect(() => {
    if (user) {
      api.getAccount().then((account) => {
        setAccount(account);
      });
    }
  }, [api, user, setAccount]);

  if (session === undefined) {
    // TODO: Add a loading state
    return <div>Loading...</div>;
  }

  return <>{children}</>;
};
