import { Router } from "express";
import { handleAuth } from "../services/authManager/express.js";
import { UsersUseCases } from "../useCases/index.js";
import { ApiKeysUseCases } from "../useCases/apikeys.js";
import { UserRole } from "../models/index.js";
import { SubscriptionsUseCases } from "../useCases/subscriptions.js";

const userController = Router();

userController.post("/@me/onboard", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { handle } = req.body;

  if (!handle) {
    return res
      .status(400)
      .json({ error: "Missing attribute `handle` in body" });
  }

  if (!/^@[A-Za-z0-9_\.]+$/.test(handle)) {
    return res.status(400).json({
      error:
        "Invalid handle format. Handle must start with @ and can only contain letters, numbers, underscores and dots",
    });
  }

  if (handle.length > 33) {
    return res.status(400).json({
      error: "Handle must be 32 characters or less",
    });
  }

  if (handle.length < 2) {
    return res.status(400).json({
      error: "Handle must be 1 characters or more",
    });
  }

  try {
    const onboardedUser = await UsersUseCases.onboardUser(user, handle);

    res.json(onboardedUser);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to update user handle" });
  }
});

userController.get("/@me", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const userInfo = await UsersUseCases.getUserInfo(user);

  res.json(userInfo);
});

userController.get("/search", async (req, res) => {
  const { handle } = req.query;

  if (typeof handle !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid attribute `handle` in query" });
  }

  const users = await UsersUseCases.searchUsersByHandle(handle);

  res.json(users);
});

userController.get("/checkHandleAvailability", async (req, res) => {
  const { handle } = req.query;

  if (typeof handle !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid attribute `handle` in query" });
  }

  const user = await UsersUseCases.getUserByHandle(handle);

  res.json({ isAvailable: !user });
});

userController.post("/apiKey/create", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  try {
    const apiKey = await ApiKeysUseCases.createApiKey(user);

    res.json(apiKey);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to create API key" });
  }
});

userController.post("/admin/add", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { handle } = req.body;

  if (typeof handle !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid attribute `handle` in body" });
  }

  try {
    await UsersUseCases.updateRole(user, handle, UserRole.Admin);

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to add user to admins" });
  }
});

userController.post("/admin/remove", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { handle } = req.body;

  if (typeof handle !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid attribute `handle` in body" });
  }

  try {
    await UsersUseCases.updateRole(user, handle, UserRole.User);

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to remove user from admins" });
  }
});

userController.post("/subscriptions/update", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { handle, uploadLimit, downloadLimit, granularity } = req.body;

  if (typeof handle !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid attribute `handle` in body" });
  }

  if (typeof uploadLimit !== "number") {
    return res
      .status(400)
      .json({ error: "Missing or invalid attribute `uploadLimit` in body" });
  }

  if (typeof downloadLimit !== "number") {
    return res
      .status(400)
      .json({ error: "Missing or invalid attribute `downloadLimit` in body" });
  }

  if (granularity !== "monthly") {
    // TODO: support other granularities
    return res.status(400).json({ error: "Invalid granularity" });
  }

  try {
    await SubscriptionsUseCases.updateSubscription(
      user,
      handle,
      granularity,
      uploadLimit,
      downloadLimit
    );

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to update subscription" });
  }
});

userController.get("/subscriptions/list", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  try {
    const users = await UsersUseCases.getUserList(user);

    res.json(users);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to get user list" });
  }
});

export { userController };
