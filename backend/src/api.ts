import cors from "cors";
import express from "express";

import "dotenv/config.js";
import { objectController } from "./controllers/object.js";
import { userController } from "./controllers/user.js";
import { handleAuth } from "./services/authManager/express.js";
import { uploadController } from "./controllers/upload.js";

const createServer = async () => {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  // Increase the limit to 10MB (adjust as needed)
  const requestSizeLimit = process.env.REQUEST_SIZE_LIMIT || "200mb";
  app.use(express.json({ limit: requestSizeLimit }));
  app.use(express.urlencoded({ limit: requestSizeLimit, extended: true }));
  process.env.CORS_ALLOW_ORIGINS &&
    app.use(cors({ origin: process.env.CORS_ALLOW_ORIGINS }));

  app.use("/objects", objectController);
  app.use("/users", userController);
  app.use("/uploads", uploadController);

  app.get("/auth/session", async (req, res) => {
    try {
      const user = await handleAuth(req, res);
      if (!user) {
        return;
      }

      res.json(user);
    } catch (error) {
      console.error("Error retrieving session:", error);
      res.status(500).json({ error: "Failed to retrieve session" });
    }
  });

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
};

createServer().catch(console.error);
