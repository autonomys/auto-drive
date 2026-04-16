/**
 * Unit tests for `createApiService().downloadObject`
 *
 * Both the skipDecryption=true and skipDecryption=false paths now use
 * `sendDownloadRequest` directly, checking `response.status` numerically.
 * This is immune to HTTP/2's always-empty statusText.
 *
 * The skipDecryption=false path additionally fetches metadata via
 * `sendAPIRequest` and applies decryption/decompression from
 * `@autonomys/auto-dag-data`.
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports so Jest hoists them
// ---------------------------------------------------------------------------

jest.mock('@autonomys/auto-drive', () => ({
  createAutoDriveApi: jest.fn(),
}));

jest.mock('utils/auth', () => ({
  getAuthSession: jest.fn(),
}));

jest.mock('utils/file', () => ({
  uploadFileContent: jest.fn(),
}));

jest.mock('@autonomys/asynchronous', () => ({
  asyncFromStream: jest.fn(),
}));

const mockDecryptFile = jest.fn();
const mockDecompressFile = jest.fn();
jest.mock('@autonomys/auto-dag-data', () => ({
  decryptFile: mockDecryptFile,
  EncryptionAlgorithm: { AES_256_GCM: 'AES_256_GCM' },
  decompressFile: mockDecompressFile,
  CompressionAlgorithm: { ZLIB: 'ZLIB' },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createApiService } from '../../../src/services/api';
import { createAutoDriveApi } from '@autonomys/auto-drive';
import { getAuthSession } from 'utils/auth';
import { asyncFromStream } from '@autonomys/asynchronous';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CID = 'bafkr6itest000000000000000000000000000000000000000000000000';
const API_BASE = 'http://localhost:3000';
const DL_BASE = 'http://localhost:3001';

const createApi = () =>
  createApiService({ apiBaseUrl: API_BASE, downloadApiUrl: DL_BASE });

/** Convenience — build a mock AutoDrive API with overrideable methods. */
const mockAutoDriveApi = (overrides: {
  sendDownloadRequest?: jest.Mock;
  sendAPIRequest?: jest.Mock;
}) => {
  const mock = {
    sendDownloadRequest: overrides.sendDownloadRequest ?? jest.fn(),
    sendAPIRequest: overrides.sendAPIRequest ?? jest.fn(),
  };
  (createAutoDriveApi as jest.Mock).mockReturnValue(mock);
  return mock;
};

/** Session fixture for an authenticated Google user. */
const SESSION_GOOGLE = { accessToken: 'tok-abc', authProvider: 'google' };

const fakeBody = {} as ReadableStream<Uint8Array>;

const okDownloadResponse = () => ({
  ok: true,
  status: 200,
  statusText: '',
  body: fakeBody,
});

const metadataResponse = (uploadOptions?: {
  encryption?: { algorithm: string };
  compression?: { algorithm: string };
}) => ({
  ok: true,
  status: 200,
  json: jest.fn().mockResolvedValue({ uploadOptions }),
});

// ---------------------------------------------------------------------------
// Encrypted / raw download  (skipDecryption: true)
// ---------------------------------------------------------------------------

describe('downloadObject — encrypted raw download (skipDecryption: true)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('anonymous — backend 402 throws the recognised "large file" login message', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue(null);

    mockAutoDriveApi({
      sendDownloadRequest: jest.fn().mockResolvedValue({
        ok: false,
        status: 402,
        statusText: 'Payment Required',
        body: null,
      }),
    });

    const api = createApi();
    await expect(
      api.downloadObject(TEST_CID, { skipDecryption: true, authMode: 'anonymous' }),
    ).rejects.toThrow(
      'Downloading large files require authorization, please login via gauth, wallet, github or discord',
    );
  });

  it('anonymous — backend 404 throws "File not found"', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue(null);

    mockAutoDriveApi({
      sendDownloadRequest: jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        body: null,
      }),
    });

    const api = createApi();
    await expect(
      api.downloadObject(TEST_CID, { skipDecryption: true, authMode: 'anonymous' }),
    ).rejects.toThrow('File not found');
  });

  it('session — 200 returns the async iterable produced by asyncFromStream', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue(SESSION_GOOGLE);

    const fakeIterable: AsyncIterable<Buffer> = (async function* () {
      yield Buffer.from('hello');
    })();

    mockAutoDriveApi({
      sendDownloadRequest: jest.fn().mockResolvedValue(okDownloadResponse()),
    });
    (asyncFromStream as jest.Mock).mockReturnValue(fakeIterable);

    const api = createApi();
    const result = await api.downloadObject(TEST_CID, {
      skipDecryption: true,
      authMode: 'session',
    });

    expect(asyncFromStream).toHaveBeenCalledWith(fakeBody);
    expect(result).toBe(fakeIterable);
  });
});

// ---------------------------------------------------------------------------
// Decrypted download  (skipDecryption: false / default)
// ---------------------------------------------------------------------------

describe('downloadObject — decrypted download (skipDecryption: false)', () => {
  beforeEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // Anonymous authMode
  // -------------------------------------------------------------------------

  describe('anonymous authMode', () => {
    beforeEach(() => {
      (getAuthSession as jest.Mock).mockResolvedValue(null);
    });

    it('backend 402 on HTTP/2 (empty statusText) throws the recognised login message', async () => {
      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(metadataResponse()),
        sendDownloadRequest: jest.fn().mockResolvedValue({
          ok: false,
          status: 402,
          statusText: '',
          body: null,
        }),
      });

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'anonymous' }),
      ).rejects.toThrow(
        'Downloading large files require authorization, please login via gauth, wallet, github or discord',
      );
    });

    it('backend 402 on HTTP/1.1 (with statusText) throws the recognised login message', async () => {
      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(metadataResponse()),
        sendDownloadRequest: jest.fn().mockResolvedValue({
          ok: false,
          status: 402,
          statusText: 'Payment Required',
          body: null,
        }),
      });

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'anonymous' }),
      ).rejects.toThrow(
        'Downloading large files require authorization, please login via gauth, wallet, github or discord',
      );
    });

    it('backend 404 throws "File not found" (not the login message)', async () => {
      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(metadataResponse()),
        sendDownloadRequest: jest.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: '',
          body: null,
        }),
      });

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'anonymous' }),
      ).rejects.toThrow('File not found');
    });

    it('backend 500 throws "Server error" (not the login message)', async () => {
      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(metadataResponse()),
        sendDownloadRequest: jest.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: '',
          body: null,
        }),
      });

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'anonymous' }),
      ).rejects.toThrow('Server error occurred while downloading the file');
    });

    it('success path returns the iterable from asyncFromStream (no encryption)', async () => {
      const fakeIterable: AsyncIterable<Buffer> = (async function* () {
        yield Buffer.from('decrypted data');
      })();

      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(metadataResponse()),
        sendDownloadRequest: jest.fn().mockResolvedValue(okDownloadResponse()),
      });
      (asyncFromStream as jest.Mock).mockReturnValue(fakeIterable);

      const api = createApi();
      const result = await api.downloadObject(TEST_CID, {
        authMode: 'anonymous',
      });

      expect(result).toBe(fakeIterable);
    });

    it('decrypts and decompresses when metadata indicates encryption + compression', async () => {
      const rawIterable = (async function* () {
        yield Buffer.from('raw');
      })();
      const decryptedIterable = (async function* () {
        yield Buffer.from('decrypted');
      })();
      const decompressedIterable = (async function* () {
        yield Buffer.from('decompressed');
      })();

      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(
          metadataResponse({
            encryption: { algorithm: 'AES_256_GCM' },
            compression: { algorithm: 'ZLIB' },
          }),
        ),
        sendDownloadRequest: jest.fn().mockResolvedValue(okDownloadResponse()),
      });
      (asyncFromStream as jest.Mock).mockReturnValue(rawIterable);
      mockDecryptFile.mockReturnValue(decryptedIterable);
      mockDecompressFile.mockReturnValue(decompressedIterable);

      const api = createApi();
      const result = await api.downloadObject(TEST_CID, {
        authMode: 'anonymous',
        password: 'secret',
      });

      expect(mockDecryptFile).toHaveBeenCalledWith(rawIterable, 'secret', {
        algorithm: 'AES_256_GCM',
      });
      expect(mockDecompressFile).toHaveBeenCalledWith(decryptedIterable, {
        algorithm: 'ZLIB',
      });
      expect(result).toBe(decompressedIterable);
    });

    it('throws when metadata indicates encryption but no password is provided', async () => {
      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(
          metadataResponse({
            encryption: { algorithm: 'AES_256_GCM' },
          }),
        ),
        sendDownloadRequest: jest.fn().mockResolvedValue(okDownloadResponse()),
      });
      (asyncFromStream as jest.Mock).mockReturnValue(
        (async function* () {})(),
      );

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'anonymous' }),
      ).rejects.toThrow('Password is required to decrypt the file');
    });
  });

  // -------------------------------------------------------------------------
  // Session authMode
  // -------------------------------------------------------------------------

  describe('session authMode', () => {
    beforeEach(() => {
      (getAuthSession as jest.Mock).mockResolvedValue(SESSION_GOOGLE);
    });

    it('success — returns the iterable from asyncFromStream', async () => {
      const fakeIterable: AsyncIterable<Buffer> = (async function* () {
        yield Buffer.from('hello session');
      })();

      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(metadataResponse()),
        sendDownloadRequest: jest.fn().mockResolvedValue(okDownloadResponse()),
      });
      (asyncFromStream as jest.Mock).mockReturnValue(fakeIterable);

      const api = createApi();
      const result = await api.downloadObject(TEST_CID, {
        authMode: 'session',
      });

      expect(result).toBe(fakeIterable);
    });

    it('402 in session mode throws "Download limit exceeded" (not the login message)', async () => {
      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(metadataResponse()),
        sendDownloadRequest: jest.fn().mockResolvedValue({
          ok: false,
          status: 402,
          statusText: '',
          body: null,
        }),
      });

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'session' }),
      ).rejects.toThrow('Download limit exceeded');
    });

    it('passes the password through to decryptFile when metadata has encryption', async () => {
      const rawIterable = (async function* () {})();
      const decryptedIterable = (async function* () {})();

      mockAutoDriveApi({
        sendAPIRequest: jest.fn().mockResolvedValue(
          metadataResponse({
            encryption: { algorithm: 'AES_256_GCM' },
          }),
        ),
        sendDownloadRequest: jest.fn().mockResolvedValue(okDownloadResponse()),
      });
      (asyncFromStream as jest.Mock).mockReturnValue(rawIterable);
      mockDecryptFile.mockReturnValue(decryptedIterable);

      const api = createApi();
      await api.downloadObject(TEST_CID, {
        authMode: 'session',
        password: 'hunter2',
      });

      expect(mockDecryptFile).toHaveBeenCalledWith(rawIterable, 'hunter2', {
        algorithm: 'AES_256_GCM',
      });
    });
  });

  // -------------------------------------------------------------------------
  // session authMode with no session available
  // -------------------------------------------------------------------------

  describe('session authMode — no session available', () => {
    it('throws the login message immediately without calling createAutoDriveApi', async () => {
      (getAuthSession as jest.Mock).mockResolvedValue(null);

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'session' }),
      ).rejects.toThrow(
        'Downloading large files require authorization, please login via gauth, wallet, github or discord',
      );

      expect(createAutoDriveApi).not.toHaveBeenCalled();
    });
  });
});
