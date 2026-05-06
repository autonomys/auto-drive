export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * Wraps a promise with a timeout. If the promise does not resolve or reject
 * within `timeoutMs` milliseconds, it rejects with a `TimeoutError`.
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'operation',
): Promise<T> => {
  if (timeoutMs <= 0) {
    return promise
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new TimeoutError(
          `${label} timed out after ${timeoutMs}ms`,
        ),
      )
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
