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

export const consumeStream = async (stream: Readable) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of stream) {
    // do nothing
  }
}
