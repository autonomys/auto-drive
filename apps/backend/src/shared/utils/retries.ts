export const withBackingOffRetries = async <T>(
  fn: () => Promise<T>,
  {
    maxRetries = 5,
    startingDelay = 500,
  }: { maxRetries?: number; startingDelay?: number } = {},
) => {
  let retries = 0
  let lastError: Error
  if (!startingDelay || startingDelay <= 0) {
    throw new Error('Starting delay must be greater than 0')
  }
  if (maxRetries <= 0) {
    throw new Error('Max retries must be greater than 0')
  }

  while (retries < maxRetries) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      const delay = startingDelay * Math.pow(2, retries)
      retries++
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError!
}
