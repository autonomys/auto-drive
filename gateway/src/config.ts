import "dotenv/config";
import { NetworkId } from "@autonomys/auto-utils";
import { env } from "./utils";

export const ApiPatternByNetwork: Partial<Record<NetworkId, string>> = {
  [NetworkId.MAINNET]: process.env.MAINNET_API_PATTERN,
  [NetworkId.TAURUS]: process.env.TAURUS_API_PATTERN,
};

export const config = {
  port: env("GATEWAY_PORT"),
  autoDriveApiKey: env("AUTO_DRIVE_API_KEY"),
};
