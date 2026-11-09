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

export const nonNegativeIntEnv = (key: string, fallback: number): number => {
  const parsed = Number(env(key, String(fallback)))
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

// Parse a positive-BigInt env var, falling back to `fallback` for missing,
// non-numeric, decimal, scientific notation, or non-positive (<= 0n) values.
// Logs a console warning on parse failure so typos do not crash service startup.
export const positiveBigIntEnv = (key: string, fallback: bigint): bigint => {
  const raw = env(key, fallback.toString())
  try {
    if (
      /^[0-9]+(\.[0-9]+)?e[+-]?[0-9]+$/i.test(raw) ||
      /^[0-9]+\.[0-9]+$/.test(raw)
    ) {
      const num = Number(raw)
      if (Number.isFinite(num) && num > 0) {
        return BigInt(Math.floor(num))
      }
    }
    const parsed = BigInt(raw)
    return parsed > 0n ? parsed : fallback
  } catch {
    console.warn(
      `[config] Invalid BigInt for ${key}: "${raw}". Falling back to default (${fallback.toString()}).`,
    )
    return fallback
  }
}

export const consumeStream = async (stream: Readable) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of stream) {
    // do nothing
  }
}
