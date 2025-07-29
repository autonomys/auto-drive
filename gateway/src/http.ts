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
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    res.status(response.status).send(await response.bytes());
    return;
  }

  const whitelistedHeaders = ["content-type"];
  for (const [key, value] of response.headers.entries()) {
    if (whitelistedHeaders.includes(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  }

  // @ts-ignore
  Readable.fromWeb(response.body).pipe(res);
};
