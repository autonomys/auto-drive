import { AwaitIterable } from 'interface-store'

export const asyncIterableMap = async <T, R>(
  iterable: AwaitIterable<T>,
  fn: (value: T) => Promise<R>,
): Promise<R[]> => {
  const result = []
  for await (const value of iterable) {
    result.push(await fn(value))
  }
  return result
}

export const asyncIterableForEach = async <T>(
  iterable: AwaitIterable<T>,
  fn: (value: T[]) => Promise<void>,
  concurrency: number,
): Promise<void> => {
  let batch: T[] = []
  for await (const value of iterable) {
    batch.push(value)
    if (batch.length === concurrency) {
      await fn(batch)
      batch = []
    }
  }

  if (batch.length > 0) {
    await fn(batch)
  }
}

export const asyncIterableToPromiseOfArray = async <T>(
  iterable: AwaitIterable<T>,
): Promise<T[]> => {
  const result = []
  for await (const value of iterable) {
    result.push(value)
  }
  return result
}
