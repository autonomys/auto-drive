import { Readable } from 'stream'

export const stringify = (value: unknown) => {
  return JSON.stringify(value, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  )
}

export const env = (key: string, defaultValue?: string) => {
  const value = process.env[key]
  if (!value) {
    if (defaultValue) {
      return defaultValue
    }
    throw new Error(`Environment variable ${key} is not set`)
  }
  return value
}

export const exhaustiveCheck = (value: never) => {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`)
}

export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

export const optionalBoolEnvironmentVariable = (key: string) =>
  process.env[key] === 'true'

// Parse a positive-integer env var, falling back to `fallback` for missing,
// non-numeric (NaN), or out-of-range (< 1) values. Avoids the
// `Math.max(1, NaN) === NaN` trap, which would otherwise leave numeric config
// (e.g. confirmation depth) comparing against NaN and never completing.
export const positiveIntEnv = (key: string, fallback: number): number => {
  const parsed = Number(env(key, String(fallback)))
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

// As `positiveIntEnv`, but admits 0 — for knobs where zero is a meaningful
// setting (typically "off") rather than an out-of-range value. `env`'s
// falsy-check means the literal string "0" would otherwise be replaced by the
// default, so the raw variable is read here instead.
export const nonNegativeIntEnv = (key: string, fallback: number): number => {
  const raw = process.env[key]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

export const consumeStream = async (stream: Readable) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of stream) {
    // do nothing
  }
}
