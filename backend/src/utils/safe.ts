export const safeCallback =
  <T, R>(callback: (...args: T[]) => R): ((...args: T[]) => R | undefined) =>
  (...args: T[]) => {
    try {
      return callback(...args)
    } catch (error) {
      console.error(error)
    }
  }
