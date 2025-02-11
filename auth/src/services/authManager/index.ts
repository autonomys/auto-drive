import { OAuthUser } from "../../models/index";
import { ApiKeyAuth } from "./providers/apikey";
import { CustomJWTAuth } from "./providers/custom";
import { DiscordAuth, GitHubAuth, GoogleAuth } from "./providers/index";

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
    case "custom-jwt":
      return CustomJWTAuth.getUserFromAccessToken(accessToken);
    case "github":
      return GitHubAuth.getUserFromAccessToken(accessToken);
    default:
      throw new Error("Invalid provider");
  }
};

export const AuthManager = {
  getUserFromAccessToken,
};
