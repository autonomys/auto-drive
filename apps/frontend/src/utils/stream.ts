export async function* streamToAsyncIterable(
  reader: ReadableStreamDefaultReader<Uint8Array | Buffer>,
): AsyncIterable<Buffer> {
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      yield Buffer.from(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export const fileStreamToAsyncIterable = async function* (
  stream: ReadableStream,
): AsyncIterable<Buffer> {
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    yield Buffer.from(value);
  }
};
