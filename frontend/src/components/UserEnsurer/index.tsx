'use client';

import { FC, PropsWithChildren, useEffect } from 'react';
import { useUserStore } from '../../states/user';

export const UserEnsurer: FC<PropsWithChildren> = ({ children }) => {
  const userStore = useUserStore(({ user }) => user);
  const updateUser = useUserStore(({ updateUser }) => updateUser);

  useEffect(() => {
    updateUser();
  }, [updateUser]);

  return userStore && children;
};
