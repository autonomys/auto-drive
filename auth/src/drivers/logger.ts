import { createLogger, format, transports } from "winston";
import { config } from "../config";

type Any =
  | object
  | string
  | number
  | boolean
  | bigint
  | undefined
  | null
  | unknown;

export interface Logger {
  info: (...message: Any[]) => Promise<void>;
  error: (...message: Any[]) => Promise<void>;
  warn: (...message: Any[]) => Promise<void>;
  debug: (...message: Any[]) => Promise<void>;
}

const winstonLogger = createLogger({
  level: config.logLevel,
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

export const logger: Logger = {
  info: async (...message: Any[]) => {
    winstonLogger.info(message.join(" "));
  },
  error: async (...message: Any[]) => {
    winstonLogger.error(message.join(" "));
  },
  warn: async (...message: Any[]) => {
    winstonLogger.warn(message.join(" "));
  },
  debug: async (...message: Any[]) => {
    winstonLogger.debug(message.join(" "));
  },
};
