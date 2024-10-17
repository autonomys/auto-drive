export const safeCallback =
  <A extends any[], R>(
    callback: (...args: A) => R
  ): ((...args: A) => R | undefined) =>
  (...args: A) => {
    try {
      return callback(...args);
    } catch (error) {
      console.error(error);
    }
  };
