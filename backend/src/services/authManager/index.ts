import { OAuthUser } from "../../models/users/index.js";
import { ApiKeyAuth } from "./providers/apikey.js";
import { DiscordAuth, GoogleAuth } from "./providers/index.js";

const getUserFromAccessToken = async (
  provider: string,
  accessToken: string
): Promise<OAuthUser> => {
  switch (provider) {
    case "google":
      return GoogleAuth.getUserFromAccessToken(accessToken);
    case "discord":
      return DiscordAuth.getUserFromAccessToken(accessToken);
    case "apikey":
      return ApiKeyAuth.getUserFromApiKey(accessToken);
    default:
      throw new Error("Invalid provider");
  }
};

export const AuthManager = {
  getUserFromAccessToken,
};
