import { Router } from "express";
import {
  handleAdminAuth,
  handleAuth,
  refreshAccessToken,
} from "../services/authManager/express";
import { UsersUseCases } from "../useCases/index";
import { ApiKeysUseCases } from "../useCases/apikeys";
import { UserRole } from "../models/index";
import { CustomJWTAuth } from "../services/authManager/providers/custom";
import { logger } from "../drivers";

const userController = Router();

userController.post("/@me/onboard", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  try {
    const onboardedUser = await UsersUseCases.onboardUser(user);
    res.json(onboardedUser);
  } catch (error) {
    console.log(error);

    res.status(500).json({
      error: "Failed to onboard user",
    });
  }
});

userController.post("/@me/accessToken", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { accessToken, refreshToken } = await CustomJWTAuth.createSessionTokens(
    {
      provider: user.oauthProvider,
      id: user.oauthUserId,
    }
  );

  res
    .cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    })
    .json({ accessToken });
});

userController.post("/@me/refreshToken", async (req, res) => {
  try {
    const refreshToken = req.headers.cookie?.match(/refreshToken=([^;]+)/)?.[1];
    if (!refreshToken) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const accessToken = await refreshAccessToken(refreshToken);

    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
});

userController.delete("/@me/invalidateToken", async (req, res) => {
  const token = req.body.token;

  if (typeof token !== "string") {
    res.status(400).json({
      error: "Missing or invalid attribute `token` in body",
    });
    return;
  }

  await CustomJWTAuth.invalidateRefreshToken(token);

  res.sendStatus(200);
});

userController.get("/@me", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    logger.warn("User not found");
    return;
  }

  try {
    const userInfo = await UsersUseCases.getUserWithOrganization(user);

    res.json(userInfo);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to get user info",
    });
    return;
  }
});

userController.get("/@me/apiKeys", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  try {
    const apiKeys = await ApiKeysUseCases.getApiKeysByUser(user);

    res.json(apiKeys);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to get API keys",
    });
    return;
  }
});

userController.post("/@me/apiKeys/create", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  try {
    const apiKey = await ApiKeysUseCases.createApiKey(user);

    res.json(apiKey);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to create API key",
    });
    return;
  }
});

userController.delete("/@me/apiKeys/:id", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { id } = req.params;

  try {
    await ApiKeysUseCases.deleteApiKey(user, id);

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to delete API key",
    });
    return;
  }
});

userController.post("/admin/add", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { publicId } = req.body;

  if (typeof publicId !== "string") {
    res.status(400).json({
      error: "Missing or invalid attribute `publicId` in body",
    });
    return;
  }

  try {
    await UsersUseCases.updateRole(user, publicId, UserRole.Admin);

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to add user to admins",
    });
    return;
  }
});

userController.post("/admin/remove", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { publicId } = req.body;

  if (typeof publicId !== "string") {
    res.status(400).json({
      error: "Missing or invalid attribute `publicId` in body",
    });
    return;
  }

  try {
    await UsersUseCases.updateRole(user, publicId, UserRole.User);

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to remove user from admins",
    });
    return;
  }
});

userController.get("/:publicId", async (req, res) => {
  const { publicId } = req.params;

  const isAdmin = await handleAdminAuth(req, res);
  if (!isAdmin) {
    res.status(401).json({
      error: "Unauthorized",
    });
    return;
  }

  const user = await UsersUseCases.getUserWithOrganization(publicId);

  res.json(user);
});

export { userController };
