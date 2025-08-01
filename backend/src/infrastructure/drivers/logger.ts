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
  trace: (...message: Any[]) => void
}

/**
 * Returns a Logger for the given namespace.
 */
export const createLogger = (namespace: string): Logger => new Log(namespace)
