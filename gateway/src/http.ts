import { Response, Request } from "express";
import { Readable } from "stream";

export const internalRedirect = async (
  req: Request,
  res: Response,
  _url: string
): Promise<void> => {
  const headers: Headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    headers.set(key, value as string);
  }

  const response = await fetch(_url, {
    headers,
  });

  const ignoreHeaders = ["content-encoding"];
  for (const [key, value] of response.headers.entries()) {
    if (ignoreHeaders.includes(key.toLowerCase())) {
      continue;
    }

    res.setHeader(key, value);
  }

  // @ts-ignore
  Readable.fromWeb(response.body).pipe(res);
};
