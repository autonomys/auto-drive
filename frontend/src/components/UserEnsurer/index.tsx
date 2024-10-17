"use client";

import { FC, PropsWithChildren, useEffect, useState } from "react";
import { useUserStore } from "../../states/user";

export const UserEnsurer: FC<PropsWithChildren> = ({ children }) => {
  const { user: userStore, updateUser } = useUserStore();

  useEffect(() => {
    updateUser();
  }, []);

  return userStore && children;
};
