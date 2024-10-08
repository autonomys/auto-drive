export type OAuthUser = {
  provider: string;
  email: string;
  id: string;
};

export type OnboardedUser = {
  oauthProvider: string;
  oauthUserId: string;
  handle: string;
  onboarded: true;
};

export type UnonboardedUser = {
  oauthProvider: string;
  oauthUserId: string;
  handle: null;
  onboarded: false;
};

export type User = OnboardedUser | UnonboardedUser;

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
