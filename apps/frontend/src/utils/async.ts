/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-this-alias */
export const asyncByChunk = async function* (
  iterable: AsyncIterable<Buffer>,
  chunkSize: number,
  ignoreLastChunk: boolean = false,
): AsyncIterable<Buffer> {
  let accumulated = Buffer.alloc(0);
  for await (const chunk of iterable) {
    accumulated = Buffer.concat([accumulated, chunk]);
    while (accumulated.length >= chunkSize) {
      yield accumulated.subarray(0, chunkSize);
      accumulated = accumulated.subarray(chunkSize);
    }
  }

  if (accumulated.length > 0 && !ignoreLastChunk) {
    yield accumulated;
  }
};
export const bufferToIterable = (buffer: Buffer): AsyncIterable<Buffer> => {
  return (async function* () {
    yield buffer;
  })();
};

export function memoizePromise<
  F extends (...args: any[]) => Promise<any> | any,
>(fn: F, ttl: number) {
  let sharedPromise: Promise<Awaited<ReturnType<F>>> | null = null;
  let timestamp: number | null = null;

  return function throttled(
    this: any,
    ...args: Parameters<F>
  ): Promise<Awaited<ReturnType<F>>> {
    if (!sharedPromise || (timestamp && Date.now() - timestamp > ttl)) {
      sharedPromise = Promise.resolve(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - apply variadic args
        fn.apply(this, args),
      ) as Promise<Awaited<ReturnType<F>>>;
      timestamp = Date.now();
    }

    return sharedPromise as Promise<Awaited<ReturnType<F>>>;
  };
}
