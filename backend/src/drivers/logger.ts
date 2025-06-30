import { Log } from 'debug-level'

// Map previous winston-based logger interface to debug-level.
// Using a default namespace of "backend" for the global logger, but callers can
// also create their own namespaced loggers via the exported `createLogger`
// helper.

export type Any =
  | object
  | string
  | number
  | boolean
  | bigint
  | undefined
  | null
  | unknown

export interface Logger {
  info: (...message: Any[]) => void
  error: (...message: Any[]) => void
  warn: (...message: Any[]) => void
  debug: (...message: Any[]) => void
}

/**
 * Internal helper that converts a debug-level Log instance into the Logger
 * shape expected by the codebase.
 */
function wrapLog(log: Log): Logger {
  return {
    info: (...message: Any[]) => {
      log.info(...message)
    },
    error: (...message: Any[]) => {
      log.error(...message)
    },
    warn: (...message: Any[]) => {
      log.warn(...message)
    },
    debug: (...message: Any[]) => {
      log.debug(...message)
    },
  }
}

/**
 * Returns a Logger for the given namespace.
 */
export const createLogger = (namespace: string): Logger =>
  wrapLog(new Log(namespace))
