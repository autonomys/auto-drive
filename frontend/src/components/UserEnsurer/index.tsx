"use client";

import { FC, PropsWithChildren, useEffect, useState } from "react";
import { useUserStore } from "../../states/user";

export const UserEnsurer: FC<PropsWithChildren> = ({ children }) => {
  const userStore = useUserStore(({ user }) => user);
  const updateUser = useUserStore(({ updateUser }) => updateUser);

  useEffect(() => {
    updateUser();
  }, []);

  return userStore && children;
};
