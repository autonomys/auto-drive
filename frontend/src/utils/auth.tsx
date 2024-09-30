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
    throw new Error("No access token");
  }

  return { accessToken: "", ...internalSession } as Session;
};
