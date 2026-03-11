'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useContext } from 'react';
import { useNetwork } from '../../contexts/network';
import { UserEnsurer } from '../atoms/UserEnsurer';
import { SessionContext } from 'next-auth/react';

export const UserProtectedLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const router = useRouter();
  const { network } = useNetwork();
  const isLoggedIn = useContext(SessionContext);

  // SessionEnsurer (in the parent layout) already calls AuthService.getMe()
  // and sets the user in the Zustand store — no need to duplicate that here.

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace(`/${network.id}/drive/global`);
    }
  }, [isLoggedIn, network.id, router]);

  return <UserEnsurer>{children}</UserEnsurer>;
};
