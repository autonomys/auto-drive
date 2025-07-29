import express from "express";

export const toPromise = <T extends Promise<unknown>>(arr: T[]) => {
  return Promise.all(arr);
};

export const removeFalsy = <T>(arr: T[]) => {
  return arr.filter((e) => !!e).map((e) => e as NonNullable<T>);
};

export const env = (key: string, defaultValue?: string) => {
  const value = process.env[key];
  if (!value) {
    if (defaultValue) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
};

export const getHeaders = (req: express.Request): HeadersInit => {
  const headers = new Headers();
  for (const key in req.headers) {
    headers.set(key, req.headers[key] as string);
  }
  return headers;
};

/**
 * Resolves an array of promises and returns the first non-null value.
 * Does not wait for all promises to resolve - returns as soon as the first non-null value is found.
 * @param promises Array of promises that resolve to potentially null values
 * @returns Promise that resolves to the first non-null value, or null if all resolve to null
 */
export const firstNonNull = async <T>(
  promises: Promise<T | null>[]
): Promise<T | null> => {
  if (promises.length === 0) {
    return null;
  }

  return new Promise((resolve) => {
    let resolved = false;
    let pendingCount = promises.length;

    const checkComplete = () => {
      if (pendingCount === 0 && !resolved) {
        resolve(null);
      }
    };

    promises.forEach((promise) => {
      promise
        .then((result) => {
          pendingCount--;
          if (!resolved && result !== null && result !== undefined) {
            resolved = true;
            resolve(result);
          } else {
            checkComplete();
          }
        })
        .catch(() => {
          pendingCount--;
          checkComplete();
        });
    });
  });
};
