import { Router } from "express";
import { handleAuth } from "../services/authManager/express.js";
import { UsersUseCases } from "../useCases/index.js";

const userController = Router();

userController.post("/@me/update", async (req, res) => {
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

  try {
    const updatedUser = await UsersUseCases.updateUserHandle(user, handle);

    res.json(updatedUser);
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

  res.json(user);
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

export { userController };
