import { OAuthUser } from "../../models/index.js";
import { GoogleAuth } from "./providers/index.js";

const getUserFromAccessToken = async (
  provider: string,
  accessToken: string
): Promise<OAuthUser> => {
  switch (provider) {
    case "google":
      return GoogleAuth.getUserFromAccessToken(accessToken);
    default:
      throw new Error("Invalid provider");
  }
};

export const AuthManager = {
  getUserFromAccessToken,
};
