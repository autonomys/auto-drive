import { User } from "../../../models/user";

type GoogleUser = {
  email: string;
  id: string;
  verified_email: boolean;
  picture: string;
  hd: string;
};

const getUserFromAccessToken = async (accessToken: string): Promise<User> => {
  const googleUser = await fetch(
    "https://www.googleapis.com/oauth2/v1/userinfo?scope=https://www.googleapis.com/auth/userinfo.email",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  ).then((res) => {
    if (res.status >= 400) {
      throw new Error("Failed to fetch user info");
    }
    return res.json() as Promise<GoogleUser>;
  });

  return {
    provider: "google",
    email: googleUser.email,
  };
};

export const GoogleAuth = {
  getUserFromAccessToken,
};
