import { app } from "./index";
import serverless from "serverless-http";

export const handler = serverless(app);
