import { Request, Response } from "express";
import { User, UserRole } from "../../models";
import { UsersUseCases } from "../../useCases/index";
import { AuthManager } from "./index";
import { CustomJWTAuth } from "./providers/custom";
import { config } from "../../config";

export const handleAuth = async (
  req: Request,
  res: Response
): Promise<User | null> => {
  const accessToken = req.headers.authorization?.split(" ")[1];
  if (!accessToken) {
    res.status(401).json({
      error: "Missing or invalid access token",
    });
    return null;
  }

  const provider = req.headers["x-auth-provider"];
  if (!provider || typeof provider !== "string") {
    res.status(401).json({
      error: "Missing or invalid x-auth-provider header",
    });

    return null;
  }

  const oauthUser = await AuthManager.getUserFromAccessToken(
    provider,
    accessToken
  ).catch(() => null);

  if (!oauthUser) {
    res.status(401).json({
      error: "Failed to authenticate user",
    });
    return null;
  }

  return UsersUseCases.getUserByOAuthUser(oauthUser);
};

export const handleApiSecretAuth = async (
  req: Request,
  res: Response
): Promise<true | null> => {
  const accessToken = req.headers.authorization?.split(" ")[1];

  if (!accessToken) {
    res.status(401).json({
      error: "Missing or invalid access token",
    });
    return null;
  }

  const isCorrectApiSecret = accessToken === config.apiSecret;
  if (!isCorrectApiSecret) {
    res.status(401).json({
      error: "Unauthorized",
    });
    return null;
  }

  return isCorrectApiSecret;
};

export const refreshAccessToken = async (
  refreshToken: string
): Promise<string | null> => {
  return CustomJWTAuth.refreshAccessToken(refreshToken);
};
