import { OAuthUser } from "../../models/index";
import { ApiKeyAuth } from "./providers/apikey";
import { CustomJWTAuth } from "./providers/custom";
import { DiscordAuth, GoogleAuth } from "./providers/index";

const getUserFromAccessToken = async (
  provider: string,
  accessToken: string
): Promise<OAuthUser> => {
  switch (provider) {
    case "google":
      console.log("google accessToken", accessToken);
      return GoogleAuth.getUserFromAccessToken(accessToken);
    case "discord":
      console.log("discord accessToken", accessToken);
      return DiscordAuth.getUserFromAccessToken(accessToken);
    case "apikey":
      console.log("apikey accessToken", accessToken);
      return ApiKeyAuth.getUserFromApiKey(accessToken);
    case "custom-jwt":
      console.log("custom-jwt accessToken", accessToken);
      return CustomJWTAuth.getUserFromAccessToken(accessToken);
    default:
      throw new Error("Invalid provider");
  }
};

export const AuthManager = {
  getUserFromAccessToken,
};
