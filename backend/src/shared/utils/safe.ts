export const safeCallback =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <T extends (...args: any[]) => any>(
      callback: T,
    ): ((...args: Parameters<T>) => Promise<ReturnType<T> | undefined>) =>
    async (...args: Parameters<T>) => {
      try {
        return await callback(...args)
      } catch (error) {
        const { createLogger } = await import(
          '../../infrastructure/drivers/logger.js'
        )
        const logger = createLogger('utils:safe')
        logger.error('Unhandled error in safeCallback', error)
      }
    }
