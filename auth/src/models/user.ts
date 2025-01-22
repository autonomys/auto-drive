export type OAuthUser = {
  provider: string;
  id: string;
  email?: string;
};

export enum UserRole {
  User = "User",
  Admin = "Admin",
}

export type PublicId = string | null;

export type UserOrPublicId = User | PublicId;

type UserBase = {
  oauthProvider: string;
  oauthUserId: string;
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

export type User = OnboardedUser | UnonboardedUser;

export type UserWithOrganization =
  | UnonboardedUser
  | (OnboardedUser & {
      organizationId: string;
    });

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
