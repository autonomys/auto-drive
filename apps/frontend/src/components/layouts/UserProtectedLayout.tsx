'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useContext } from 'react';
import { useNetwork } from '../../contexts/network';
import { AuthService } from '../../services/auth/auth';
import { useUserStore } from '../../globalStates/user';
import { UserEnsurer } from '../atoms/UserEnsurer';
import { SessionContext } from 'next-auth/react';

export const UserProtectedLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const router = useRouter();
  const { network } = useNetwork();
  const setUser = useUserStore(({ setUser }) => setUser);
  const isLoggedIn = useContext(SessionContext);

  useEffect(() => {
    AuthService.getMe().then((user) => {
      if (user.onboarded) {
        setUser(user);
      } else {
        router.push('/onboarding');
      }
    });
  }, [isLoggedIn, network.id, router, setUser]);

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace(`/${network.id}/drive/global`);
    }
  }, [isLoggedIn, network.id, router]);

  return <UserEnsurer>{children}</UserEnsurer>;
};
