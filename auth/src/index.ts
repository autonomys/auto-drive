import "dotenv/config";
import express from "express";
import cors from "cors";
import { userController } from "./controllers/user";
import { config } from "./config";
import { logger } from "./drivers";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, _, next) => {
  logger.info(`Request: ${req.method} ${req.url}`);
  next();
});

if (config.corsAllowedOrigins) {
  app.use(
    cors({
      origin: config.corsAllowedOrigins,
    })
  );
}

app.use("/users", userController);

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});

export { app };
