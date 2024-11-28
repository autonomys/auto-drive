import { createAutoDriveApi } from "@autonomys/auto-drive";
import dotenv from "dotenv";

dotenv.config({
  path: ".env.test",
});

const url = process.env.AUTO_DRIVE_URL;
const apiKey = process.env.AUTO_DRIVE_API_KEY;

if (!url || !apiKey) {
  throw new Error("AUTO_DRIVE_URL and AUTO_DRIVE_API_KEY must be set");
}

export const api = createAutoDriveApi({
  apiKey,
  url,
});
