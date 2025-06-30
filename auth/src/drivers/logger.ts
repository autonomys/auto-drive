import { Log } from 'debug-level'

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
    trace: (...message: Any[]) => {
      log.trace(...message)
    },
  }
}

export const createLogger = (namespace: string): Logger =>
  wrapLog(new Log(namespace))

// Automatically forward any direct console.* calls through debug-level so that
// they respect the configured log level and formatting options.
Log.wrapConsole()
