export type OAuthUser = {
  provider: string;
  email: string;
  id: string;
};

export enum UserRole {
  User = 'User',
  Admin = 'Admin',
}

export type PublicId = string | null;

export type UserOrPublicId = User | PublicId;

type UserBase = {
  oauthProvider: string;
  oauthUserId: string;
  role: UserRole;
  downloadCredits: number;
  uploadCredits: number;
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

export type UserInfo =
  | (OnboardedUser & { organizationId: string })
  | UnonboardedUser;

export const userFromOAuth = (
  user: Omit<User, 'onboarded' | 'publicId'>,
): UnonboardedUser => {
  return {
    ...user,
    publicId: null,
    onboarded: false,
  };
};

export const userFromTable = (
  user: Omit<OnboardedUser, 'onboarded'>,
): OnboardedUser => {
  return {
    ...user,
    onboarded: true,
  };
};
