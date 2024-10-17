"use client";

import { FC, PropsWithChildren } from "react";
import { useUserStore } from "../../states/user";
import { UserRole } from "../../models/User";

export const RoleProtected: FC<PropsWithChildren<{ roles: UserRole[] }>> = ({
  children,
  roles,
}) => {
  const { user } = useUserStore();

  return user && roles.includes(user.role) && children;
};
