import { getServerSession, type Session as InternalSessionT } from "next-auth";
import { getSession } from "next-auth/react";

type Session = InternalSessionT & {
  accessToken: string;
};

export const getAuthSession = async (): Promise<Session | null> => {
  const internalSession = await (typeof window === "undefined"
    ? getServerSession()
    : getSession());

  // @ts-ignore
  if (!internalSession?.accessToken) {
    console.log("access token", internalSession);
    return null;
  }

  return { accessToken: "", ...internalSession } as Session;
};

export const isAuthenticated = async (): Promise<boolean> => {
  const internalSession = await (typeof window === "undefined"
    ? getServerSession()
    : getSession());

  return !!internalSession;
};
