import { User } from "../../models/user";
import { GoogleAuth } from "./google";

const getUserFromAccessToken = async (
  provider: string,
  accessToken: string
): Promise<User> => {
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
