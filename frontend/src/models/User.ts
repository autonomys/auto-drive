import { SubscriptionInfo } from "./Subscriptions";

export type OAuthUser = {
  provider: string;
  email: string;
  id: string;
};

export enum UserRole {
  User = "User",
  Admin = "Admin",
}

export type Handle = string | null;

export type UserOrHandle = User | Handle;

type UserBase = {
  oauthProvider: string;
  oauthUserId: string;
  role: UserRole;
  downloadCredits: number;
  uploadCredits: number;
  handle: Handle;
};

export type OnboardedUser = UserBase & {
  handle: string;
  onboarded: true;
};

export type UnonboardedUser = UserBase & {
  handle: null;
  onboarded: false;
};

export type User = OnboardedUser | UnonboardedUser;

export type UserInfo = {
  user: User;
  subscription: SubscriptionInfo;
};

export const userFromOAuth = (
  user: Omit<User, "onboarded" | "handle">
): UnonboardedUser => {
  return {
    ...user,
    handle: null,
    onboarded: false,
  };
};

export const userFromTable = (
  user: Omit<OnboardedUser, "onboarded">
): OnboardedUser => {
  return {
    ...user,
    onboarded: true,
  };
};
