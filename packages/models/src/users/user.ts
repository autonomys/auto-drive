import { Organization } from "./organization";
import { SubscriptionInfo } from "./subscription";

export type OAuthUser = {
  provider: string;
  id: string;
  email?: string;
  username?: string;
  avatarUrl?: string;
};

export enum UserRole {
  User = "User",
  Admin = "Admin",
}

export type PublicId = string | null;

export type UserOrPublicId = MaybeUser | PublicId;

type UserBase = {
  oauthProvider: string;
  oauthUserId: string;
  oauthUsername?: string;
  oauthAvatarUrl?: string;
  role: UserRole;
  publicId: PublicId;
};

export type OnboardedUser = UserBase & {
  publicId: string;
  onboarded: true;
};

export type UnonboardedUser = UserBase & {
  publicId: null;
  onboarded: false;
};

export type User = OnboardedUser;

export type MaybeUser = User | UnonboardedUser;

export type UserWithOrganization = User & {
  organizationId: Organization["id"] | null;
};

type UnonboardedUserWithOrganization = UnonboardedUser & {
  organizationId: null;
};

export type MaybeUserWithOrganization =
  | UserWithOrganization
  | UnonboardedUserWithOrganization;

export type UserInfo = {
  user: MaybeUser;
  subscription: SubscriptionInfo;
};

export const userFromOAuth = (
  user: Omit<User, "onboarded" | "publicId">
): UnonboardedUser => {
  return {
    ...user,
    publicId: null,
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

export const isAdminUser = (user: User): boolean => {
  return user.role === UserRole.Admin;
};
