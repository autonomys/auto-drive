export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * Wraps a promise with a timeout. If the promise does not resolve or reject
 * within `timeoutMs` milliseconds, it rejects with a `TimeoutError`.
 *
 * If an `AbortController` is provided, it will be aborted when the timeout
 * fires, allowing the underlying operation to observe the signal and clean up.
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'operation',
  abortController?: AbortController,
): Promise<T> => {
  if (timeoutMs <= 0) {
    return promise
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (abortController) {
        abortController.abort(
          new TimeoutError(`${label} timed out after ${timeoutMs}ms`),
        )
      }
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
