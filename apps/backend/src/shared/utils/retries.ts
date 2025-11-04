export const withBackingOffRetries = async <T>(
  fn: () => Promise<T>,
  {
    maxRetries = 5,
    startingDelay = 500,
  }: { maxRetries?: number; startingDelay?: number } = {},
) => {
  let retries = 0
  let lastError: Error

  while (retries < maxRetries) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      retries++
      const delay = startingDelay * Math.pow(2, retries)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError!
}
