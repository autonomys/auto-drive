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
  const setSubscription = useUserStore(
    ({ setSubscription }) => setSubscription,
  );
  const setFeatures = useUserStore(({ setFeatures }) => setFeatures);

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
  }, [api, router, session, session?.data, setSubscription, setUser]);

  useEffect(() => {
    api.getFeatures().then((features) => {
      setFeatures(features);
    });
  }, [api, setFeatures]);

  useEffect(() => {
    if (user) {
      api.getSubscription().then((subscription) => {
        setSubscription(subscription);
      });
    }
  }, [api, user, setSubscription]);

  if (session === undefined) {
    // TODO: Add a loading state
    return <div>Loading...</div>;
  }

  return <>{children}</>;
};
