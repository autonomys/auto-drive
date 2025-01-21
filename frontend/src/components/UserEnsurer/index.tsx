'use client';

import { FC, PropsWithChildren, useEffect } from 'react';
import { useUserStore } from '../../states/user';

export const UserEnsurer: FC<PropsWithChildren> = ({ children }) => {
  const user = useUserStore(({ user }) => user);
  const updateUser = useUserStore(({ updateUser }) => updateUser);

  const updateSubscription = useUserStore(
    ({ updateSubscription }) => updateSubscription,
  );

  useEffect(() => {
    updateUser();
    updateSubscription();
  }, [updateUser, updateSubscription]);

  return user && children;
};
