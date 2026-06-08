import type { OffchainMetadata } from '@autonomys/auto-dag-data';
import type { Api } from '../../../services/api';

// Collect a download stream into a single contiguous byte array, bailing out
// promptly if the preview request has been superseded/aborted.
export const collectStream = async (
  iterable: AsyncIterable<Buffer>,
  signal: AbortSignal,
): Promise<ArrayBuffer> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of iterable) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    chunks.push(new Uint8Array(chunk));
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }
  return combined.buffer as ArrayBuffer;
};

// Cheap O(1) zlib (RFC 1950) header check matching what the SDK's Zlib
// compressor emits on upload. Some objects are flagged `compression: ZLIB`
// while their stored bytes are actually uncompressed (an upload-side mismatch);
// sniffing lets us inflate only when the data really is compressed, instead of
// attempting decompression and catching a thrown FlateError after the fact.
export const looksLikeZlib = (bytes: Uint8Array): boolean =>
  bytes.length >= 2 &&
  (bytes[0] & 0x0f) === 8 &&
  ((bytes[0] << 8) | bytes[1]) % 31 === 0;

// Push a single in-memory buffer through one of the SDK's streaming transforms
// (decrypt / decompress) and collect the result back into bytes. Feeding the
// whole buffer as one chunk mirrors what the SDK's own `decryptFileData` does.
const runStreamTransform = async (
  bytes: Uint8Array,
  transform: (input: AsyncIterable<Buffer>) => AsyncIterable<Buffer>,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const source = (async function* () {
    yield Buffer.from(bytes);
  })();
  return new Uint8Array(await collectStream(transform(source), signal));
};

// Resolve a previewable file to its plaintext bytes in a transport-agnostic way.
// We always pull the RAW stored bytes (downloadObject uses ignoreEncoding=true,
// and skipDecryption avoids any SDK-side transform), then decrypt/decompress
// here. This makes previews work no matter how the gateway serves the body:
// whether it decompresses server-side, mislabels it with `Content-Encoding:
// deflate`, or returns the bytes verbatim — we never rely on the wire encoding.
export const loadPlaintextBytes = async (
  api: Api,
  metadata: OffchainMetadata,
  password: string | undefined,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  let bytes: Uint8Array = new Uint8Array(
    await collectStream(
      await api.downloadObject(metadata.dataCid, { skipDecryption: true }),
      signal,
    ),
  );

  // Stored layout is encrypt(compress(data)), so decrypt before decompressing.
  const encryption = metadata.uploadOptions?.encryption;
  if (encryption) {
    if (!password) {
      throw new Error('Password is required to decrypt the file');
    }
    const { decryptFile } = await import('@autonomys/auto-dag-data');
    bytes = await runStreamTransform(
      bytes,
      (input) =>
        decryptFile(input, password, { algorithm: encryption.algorithm }),
      signal,
    );
  }

  // Inflate only when the (now-decrypted) bytes actually carry a zlib header —
  // some objects are flagged compressed but were stored raw.
  const compression = metadata.uploadOptions?.compression;
  if (compression && looksLikeZlib(bytes)) {
    const { decompressFile } = await import('@autonomys/auto-dag-data');
    bytes = await runStreamTransform(
      bytes,
      (input) => decompressFile(input, { algorithm: compression.algorithm }),
      signal,
    );
  }

  return bytes;
};
