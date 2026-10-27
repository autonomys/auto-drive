/**
 * Unit tests for the transport-agnostic preview decode pipeline
 * (`components/molecules/FilePreview/decode.ts`).
 *
 * These cover the defensive logic that makes previews work regardless of how
 * the gateway labels the response body:
 *   - `looksLikeZlib` — the O(1) zlib-header sniff.
 *   - `loadPlaintextBytes` — always pulls RAW stored bytes (skipDecryption),
 *     then decrypts/decompresses client-side, inflating only when the bytes
 *     genuinely carry a zlib header.
 *
 * The SDK stream transforms are mocked the same way as `downloadObject.spec.ts`.
 */

// ---------------------------------------------------------------------------
// Module mocks — declared before imports so Jest hoists them. decode.ts
// dynamically imports decryptFile/decompressFile from this module.
// ---------------------------------------------------------------------------

const mockDecryptFile = jest.fn();
const mockDecompressFile = jest.fn();
jest.mock('@autonomys/auto-dag-data', () => ({
  decryptFile: mockDecryptFile,
  decompressFile: mockDecompressFile,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import zlib from 'node:zlib';
import {
  looksLikeZlib,
  loadPlaintextBytes,
  DecryptionError,
} from '../../../src/components/molecules/FilePreview/decode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CID = 'bafkr6itest000000000000000000000000000000000000000000000000';

/** Build an async iterable of Buffer chunks from one or more byte arrays. */
const streamOf = (...buffers: Uint8Array[]): AsyncIterable<Buffer> =>
  (async function* () {
    for (const b of buffers) {
      yield Buffer.from(b);
    }
  })();

/** Single-chunk async iterable, as the SDK transforms would return. */
const iterableOf = (bytes: Uint8Array): AsyncIterable<Buffer> => streamOf(bytes);

/** Minimal Api stand-in exposing only the method decode.ts uses. */
const apiWithRawBytes = (raw: Uint8Array) =>
  ({
    downloadObject: jest.fn().mockResolvedValue(streamOf(raw)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const metadataOf = (uploadOptions?: any): any => ({
  type: 'file',
  dataCid: TEST_CID,
  name: 'file.bin',
  uploadOptions: uploadOptions ?? {},
});

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const ZLIB_BYTES = new Uint8Array(zlib.deflateSync(Buffer.from('hello world')));
const RAW_DEFLATE = new Uint8Array(
  zlib.deflateRawSync(Buffer.from('hello world')),
);
const GZIP_BYTES = new Uint8Array(zlib.gzipSync(Buffer.from('hello world')));

const notAborted = new AbortController().signal;

// ---------------------------------------------------------------------------
// looksLikeZlib
// ---------------------------------------------------------------------------

describe('looksLikeZlib', () => {
  it('returns true for real zlib-wrapped (RFC 1950) data', () => {
    expect(looksLikeZlib(ZLIB_BYTES)).toBe(true);
  });

  it('returns false for raw DEFLATE without a zlib header', () => {
    expect(looksLikeZlib(RAW_DEFLATE)).toBe(false);
  });

  it('returns false for gzip data (0x1f 0x8b)', () => {
    expect(looksLikeZlib(GZIP_BYTES)).toBe(false);
  });

  it('returns false for an uncompressed PNG header', () => {
    expect(looksLikeZlib(PNG_MAGIC)).toBe(false);
  });

  it('returns false for too-short input', () => {
    expect(looksLikeZlib(new Uint8Array([0x78]))).toBe(false);
    expect(looksLikeZlib(new Uint8Array([]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadPlaintextBytes
// ---------------------------------------------------------------------------

describe('loadPlaintextBytes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('plain (no encryption/compression) returns the raw bytes untouched', async () => {
    const api = apiWithRawBytes(PNG_MAGIC);

    const result = await loadPlaintextBytes(api, metadataOf(), undefined, notAborted);

    expect(api.downloadObject).toHaveBeenCalledWith(TEST_CID, {
      skipDecryption: true,
      // The abort signal is forwarded so a preview timeout / superseded request
      // tears down the in-flight HTTP request rather than hanging on it.
      signal: notAborted,
    });
    expect(Array.from(result)).toEqual(Array.from(PNG_MAGIC));
    expect(mockDecryptFile).not.toHaveBeenCalled();
    expect(mockDecompressFile).not.toHaveBeenCalled();
  });

  it('compressed + real zlib bytes → calls decompressFile', async () => {
    const inflated = new Uint8Array([1, 2, 3, 4]);
    const api = apiWithRawBytes(ZLIB_BYTES);
    mockDecompressFile.mockReturnValue(iterableOf(inflated));

    const result = await loadPlaintextBytes(
      api,
      metadataOf({ compression: { algorithm: 'ZLIB' } }),
      undefined,
      notAborted,
    );

    expect(mockDecompressFile).toHaveBeenCalledTimes(1);
    expect(mockDecompressFile).toHaveBeenCalledWith(expect.anything(), {
      algorithm: 'ZLIB',
    });
    expect(Array.from(result)).toEqual(Array.from(inflated));
  });

  it('compressed flag but bytes are NOT zlib (mismatch) → passes through raw, no inflate', async () => {
    const api = apiWithRawBytes(PNG_MAGIC);

    const result = await loadPlaintextBytes(
      api,
      metadataOf({ compression: { algorithm: 'ZLIB' } }),
      undefined,
      notAborted,
    );

    expect(mockDecompressFile).not.toHaveBeenCalled();
    expect(Array.from(result)).toEqual(Array.from(PNG_MAGIC));
  });

  it('encrypted without a password throws a DecryptionError before any download work', async () => {
    const api = apiWithRawBytes(PNG_MAGIC);

    await expect(
      loadPlaintextBytes(
        api,
        metadataOf({ encryption: { algorithm: 'AES_256_GCM' } }),
        undefined,
        notAborted,
      ),
    ).rejects.toThrow('Password is required to decrypt the file');
    await expect(
      loadPlaintextBytes(
        api,
        metadataOf({ encryption: { algorithm: 'AES_256_GCM' } }),
        undefined,
        notAborted,
      ),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('encrypted + compressed → decrypts, then inflates when decrypted bytes are zlib', async () => {
    const plaintext = new Uint8Array([9, 9, 9]);
    const api = apiWithRawBytes(new Uint8Array([0xaa, 0xbb])); // ciphertext
    // decryptFile yields zlib-wrapped bytes; decompressFile yields plaintext.
    mockDecryptFile.mockReturnValue(iterableOf(ZLIB_BYTES));
    mockDecompressFile.mockReturnValue(iterableOf(plaintext));

    const result = await loadPlaintextBytes(
      api,
      metadataOf({
        encryption: { algorithm: 'AES_256_GCM' },
        compression: { algorithm: 'ZLIB' },
      }),
      'secret',
      notAborted,
    );

    expect(mockDecryptFile).toHaveBeenCalledWith(expect.anything(), 'secret', {
      algorithm: 'AES_256_GCM',
    });
    expect(mockDecompressFile).toHaveBeenCalledTimes(1);
    expect(Array.from(result)).toEqual(Array.from(plaintext));
  });

  it('encrypted + compressed but decrypted bytes are NOT zlib → decrypts only, no inflate', async () => {
    const plaintext = new Uint8Array([...PNG_MAGIC]);
    const api = apiWithRawBytes(new Uint8Array([0xaa, 0xbb]));
    mockDecryptFile.mockReturnValue(iterableOf(plaintext));

    const result = await loadPlaintextBytes(
      api,
      metadataOf({
        encryption: { algorithm: 'AES_256_GCM' },
        compression: { algorithm: 'ZLIB' },
      }),
      'secret',
      notAborted,
    );

    expect(mockDecryptFile).toHaveBeenCalledTimes(1);
    expect(mockDecompressFile).not.toHaveBeenCalled();
    expect(Array.from(result)).toEqual(Array.from(plaintext));
  });

  it('encrypted only (no compression) → decrypts, never inflates', async () => {
    const plaintext = new Uint8Array([7, 7]);
    const api = apiWithRawBytes(new Uint8Array([0xaa, 0xbb]));
    mockDecryptFile.mockReturnValue(iterableOf(plaintext));

    const result = await loadPlaintextBytes(
      api,
      metadataOf({ encryption: { algorithm: 'AES_256_GCM' } }),
      'secret',
      notAborted,
    );

    expect(mockDecryptFile).toHaveBeenCalledTimes(1);
    expect(mockDecompressFile).not.toHaveBeenCalled();
    expect(Array.from(result)).toEqual(Array.from(plaintext));
  });

  it('aborts collection when the signal is already aborted', async () => {
    const api = apiWithRawBytes(PNG_MAGIC);
    const aborted = AbortSignal.abort();

    await expect(
      loadPlaintextBytes(api, metadataOf(), undefined, aborted),
    ).rejects.toThrow('Aborted');
  });

  it('aborts when the signal fires after the final chunk but before return', async () => {
    const controller = new AbortController();
    // The abort lands once the stream has fully drained — after the last chunk
    // is yielded but before collectStream assembles/returns the buffer. The
    // loop-top guard never sees it, so only a post-loop re-check throws.
    const api = {
      downloadObject: jest.fn().mockResolvedValue(
        (async function* () {
          yield Buffer.from(PNG_MAGIC);
          controller.abort();
        })(),
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expect(
      loadPlaintextBytes(api, metadataOf(), undefined, controller.signal),
    ).rejects.toThrow('Aborted');
  });

  it('wraps a failing decrypt step in a DecryptionError', async () => {
    const api = apiWithRawBytes(new Uint8Array([0xaa, 0xbb]));
    // Web Crypto surfaces wrong-password / corrupt-ciphertext as a throw while
    // the transform stream is consumed.
    mockDecryptFile.mockReturnValue(
      (async function* () {
        throw new Error('unable to authenticate data');
        // eslint-disable-next-line no-unreachable
        yield Buffer.from([]);
      })(),
    );

    const promise = loadPlaintextBytes(
      api,
      metadataOf({ encryption: { algorithm: 'AES_256_GCM' } }),
      'wrong-password',
      notAborted,
    );

    await expect(promise).rejects.toBeInstanceOf(DecryptionError);
    await expect(promise).rejects.toThrow(
      'Invalid password or decryption failed',
    );
  });

  it('does NOT mask a download/network failure on an encrypted file as a DecryptionError', async () => {
    const networkError = new Error('Failed to fetch file: 404 Not Found');
    const api = {
      downloadObject: jest.fn().mockRejectedValue(networkError),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const promise = loadPlaintextBytes(
      api,
      metadataOf({ encryption: { algorithm: 'AES_256_GCM' } }),
      'secret',
      notAborted,
    );

    await expect(promise).rejects.toBe(networkError);
    await expect(promise).rejects.not.toBeInstanceOf(DecryptionError);
    // The decrypt step is never reached when the download itself fails.
    expect(mockDecryptFile).not.toHaveBeenCalled();
  });

  it('propagates an abort during the decrypt step as an AbortError, not a DecryptionError', async () => {
    const controller = new AbortController();
    const api = apiWithRawBytes(new Uint8Array([0xaa, 0xbb]));
    // The decrypt stream observes an abort mid-flight.
    mockDecryptFile.mockReturnValue(
      (async function* () {
        controller.abort();
        yield Buffer.from([0x01]);
      })(),
    );

    const promise = loadPlaintextBytes(
      api,
      metadataOf({ encryption: { algorithm: 'AES_256_GCM' } }),
      'secret',
      controller.signal,
    );

    await expect(promise).rejects.toThrow('Aborted');
    await expect(promise).rejects.not.toBeInstanceOf(DecryptionError);
  });
});
