'use client';

import { FC, PropsWithChildren } from 'react';
import { useUserStore } from 'globalStates/user';
import { UserRole } from '@auto-drive/models';

export const RoleProtected: FC<PropsWithChildren<{ roles: UserRole[] }>> = ({
  children,
  roles,
}) => {
  const user = useUserStore(({ user }) => user);

  return user && roles.includes(user.role) && children;
};
