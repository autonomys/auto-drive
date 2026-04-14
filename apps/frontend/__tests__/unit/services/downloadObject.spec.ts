/**
 * Unit tests for `createApiService().downloadObject`
 *
 * These tests cover all four download scenarios:
 *   1. Encrypted raw download (skipDecryption=true) — anonymous 402 path
 *   2. Encrypted raw download (skipDecryption=true) — session success path
 *   3. Decrypted download (skipDecryption=false) — anonymous, including the
 *      HTTP/2 empty-statusText bug regression
 *   4. Decrypted download (skipDecryption=false) — session
 *
 * External dependencies are fully mocked so no network or Next.js runtime is
 * required.
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

// uploadFileContent is imported by api.ts but never used in downloadObject.
jest.mock('utils/file', () => ({
  uploadFileContent: jest.fn(),
}));

// asyncFromStream is dynamically imported inside the skipDecryption=true path.
jest.mock('@autonomys/asynchronous', () => ({
  asyncFromStream: jest.fn(),
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
  downloadFile?: jest.Mock;
}) => {
  const mock = {
    sendDownloadRequest: overrides.sendDownloadRequest ?? jest.fn(),
    downloadFile: overrides.downloadFile ?? jest.fn(),
  };
  (createAutoDriveApi as jest.Mock).mockReturnValue(mock);
  return mock;
};

/** Session fixture for an authenticated Google user. */
const SESSION_GOOGLE = { accessToken: 'tok-abc', authProvider: 'google' };

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

    const fakeBody = {} as ReadableStream<Uint8Array>; // opaque stub
    const fakeIterable: AsyncIterable<Buffer> = (async function* () {
      yield Buffer.from('hello');
    })();

    mockAutoDriveApi({
      sendDownloadRequest: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: fakeBody,
      }),
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

    /**
     * BUG REGRESSION
     *
     * HTTP/2 always delivers an empty statusText.  The SDK's internal
     * downloadObject therefore throws:
     *
     *   new Error('Failed to download file: ' + response.statusText)
     *   // → "Failed to download file: "  (empty suffix)
     *
     * Before the fix, `isAnonymousTooLargeError` in download.ts did NOT match
     * this message (it checks for "file too large", "payment required", etc.),
     * so `fetchFromApi` never attempted the session-auth retry.
     *
     * The fix in api.ts wraps `downloadFile` in a try-catch and re-throws
     * with the well-known login message whenever the error starts with
     * "Failed to download file:" AND authMode is 'anonymous'.
     */
    it('[BUG REGRESSION] HTTP/2 empty-statusText SDK error is re-thrown as the recognised login message', async () => {
      // Reproduce the exact error the SDK raises on HTTP/2 (statusText === "").
      mockAutoDriveApi({
        downloadFile: jest.fn().mockRejectedValue(
          new Error('Failed to download file: '),
        ),
      });

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'anonymous' }),
      ).rejects.toThrow(
        'Downloading large files require authorization, please login via gauth, wallet, github or discord',
      );
    });

    it('SDK error with non-empty statusText starting with "Failed to download file:" is also re-thrown as the login message', async () => {
      // HTTP/1.1 equivalent — statusText is populated but still represents a
      // 402/other auth-related failure from the SDK.
      mockAutoDriveApi({
        downloadFile: jest.fn().mockRejectedValue(
          new Error('Failed to download file: Payment Required'),
        ),
      });

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'anonymous' }),
      ).rejects.toThrow(
        'Downloading large files require authorization, please login via gauth, wallet, github or discord',
      );
    });

    it('unrelated SDK errors are propagated unchanged', async () => {
      const originalError = new Error('Network connection reset');
      mockAutoDriveApi({
        downloadFile: jest.fn().mockRejectedValue(originalError),
      });

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'anonymous' }),
      ).rejects.toThrow('Network connection reset');
    });

    it('non-Error rejections are propagated unchanged', async () => {
      mockAutoDriveApi({
        downloadFile: jest.fn().mockRejectedValue('string error'),
      });

      const api = createApi();
      // rejects with the original non-Error value
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'anonymous' }),
      ).rejects.toBe('string error');
    });

    it('success path returns the iterable from downloadFile', async () => {
      const fakeIterable: AsyncIterable<Buffer> = (async function* () {
        yield Buffer.from('decrypted data');
      })();
      mockAutoDriveApi({
        downloadFile: jest.fn().mockResolvedValue(fakeIterable),
      });

      const api = createApi();
      const result = await api.downloadObject(TEST_CID, {
        authMode: 'anonymous',
      });

      expect(result).toBe(fakeIterable);
    });
  });

  // -------------------------------------------------------------------------
  // Session authMode
  // -------------------------------------------------------------------------

  describe('session authMode', () => {
    beforeEach(() => {
      (getAuthSession as jest.Mock).mockResolvedValue(SESSION_GOOGLE);
    });

    it('success — returns the iterable from downloadFile', async () => {
      const fakeIterable: AsyncIterable<Buffer> = (async function* () {
        yield Buffer.from('hello session');
      })();
      mockAutoDriveApi({
        downloadFile: jest.fn().mockResolvedValue(fakeIterable),
      });

      const api = createApi();
      const result = await api.downloadObject(TEST_CID, {
        authMode: 'session',
      });

      expect(result).toBe(fakeIterable);
    });

    it('"Failed to download file:" errors are NOT re-thrown — they propagate as-is in session mode', async () => {
      // The re-throw guard is anonymous-only; session errors must bubble up
      // unchanged so the caller gets the real error.
      const sdkError = new Error('Failed to download file: ');
      mockAutoDriveApi({
        downloadFile: jest.fn().mockRejectedValue(sdkError),
      });

      const api = createApi();
      await expect(
        api.downloadObject(TEST_CID, { authMode: 'session' }),
      ).rejects.toBe(sdkError);
    });

    it('passes the password to downloadFile when provided', async () => {
      const fakeIterable: AsyncIterable<Buffer> = (async function* () {})();
      const downloadFileMock = jest.fn().mockResolvedValue(fakeIterable);
      mockAutoDriveApi({ downloadFile: downloadFileMock });

      const api = createApi();
      await api.downloadObject(TEST_CID, {
        authMode: 'session',
        password: 'hunter2',
      });

      expect(downloadFileMock).toHaveBeenCalledWith(TEST_CID, 'hunter2');
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

      // createAutoDriveApi should never be reached
      expect(createAutoDriveApi).not.toHaveBeenCalled();
    });
  });
});
