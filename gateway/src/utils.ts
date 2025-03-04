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
