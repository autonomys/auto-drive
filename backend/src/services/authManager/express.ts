import { Request, Response } from "express";
import { AuthManager } from "./index.js";

export const handleAuth = async (req: Request, res: Response) => {
  const accessToken = req.headers.authorization?.split(" ")[1];
  if (!accessToken) {
    res.status(401).json({ error: "Missing or invalid access token" });
    return null;
  }

  const provider = req.headers["x-auth-provider"];
  if (!provider || typeof provider !== "string") {
    res
      .status(401)
      .json({ error: "Missing or invalid x-auth-provider header" });

    return null;
  }

  const user = await AuthManager.getUserFromAccessToken(
    provider,
    accessToken
  ).catch(() => null);

  if (!user) {
    res.status(401).json({ error: "Failed to authenticate user" });
    return null;
  }

  return user;
};
