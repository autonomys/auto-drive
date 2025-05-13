export const safeCallback =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <T extends (...args: any[]) => any>(
      callback: T,
    ): ((...args: Parameters<T>) => ReturnType<T> | undefined) =>
    (...args: Parameters<T>) => {
      try {
        return callback(...args)
      } catch (error) {
        console.error(error)
      }
    }
