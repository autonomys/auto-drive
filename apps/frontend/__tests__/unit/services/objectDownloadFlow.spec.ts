jest.mock('utils/auth', () => ({
  getAuthSession: jest.fn(),
}));

jest.mock('@auto-drive/models', () => ({
  AsyncDownloadStatus: {
    Failed: 'failed',
    Dismissed: 'dismissed',
  },
  DownloadStatus: {
    Cached: 'cached',
    NotCached: 'not-cached',
  },
}));

import { AsyncDownloadStatus, DownloadStatus } from '@auto-drive/models';
import { getAuthSession } from 'utils/auth';
import { runObjectDownloadFlow } from '../../../src/services/objectDownloadFlow';

const metadata = {
  dataCid: 'bafkr6itestcid',
  name: 'test.txt',
  type: 'file',
  totalSize: 12,
  uploadOptions: {},
};

const createDependencies = () => {
  const api = {
    checkDownloadStatus: jest.fn(),
    createAsyncDownload: jest.fn(),
  };
  const downloadService = {
    fetchFile: jest.fn(),
  };

  return { api, downloadService };
};

describe('runObjectDownloadFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('downloads immediately when the object is already cached', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue({
      accessToken: 'token',
      authProvider: 'google',
    });
    const { api, downloadService } = createDependencies();
    api.checkDownloadStatus.mockResolvedValue(DownloadStatus.Cached);

    await runObjectDownloadFlow({
      api: api as never,
      downloadService,
      metadata: metadata as never,
      password: 'secret',
      onPhaseChange: jest.fn(),
    });

    expect(api.checkDownloadStatus).toHaveBeenCalledWith(metadata.dataCid);
    expect(api.createAsyncDownload).not.toHaveBeenCalled();
    expect(downloadService.fetchFile).toHaveBeenCalledWith(metadata.dataCid, {
      password: 'secret',
      skipDecryption: false,
      onProgress: undefined,
    });
  });

  it('creates an async download for uncached authenticated objects before downloading', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue({
      accessToken: 'token',
      authProvider: 'google',
    });
    const { api, downloadService } = createDependencies();
    api.checkDownloadStatus
      .mockResolvedValueOnce(DownloadStatus.NotCached)
      .mockResolvedValueOnce(DownloadStatus.Cached);
    const onPhaseChange = jest.fn();
    const onAsyncDownloadsRefresh = jest.fn();

    await runObjectDownloadFlow({
      api: api as never,
      downloadService,
      metadata: metadata as never,
      asyncPollIntervalMs: 0,
      onPhaseChange,
      onAsyncDownloadsRefresh,
    });

    expect(api.createAsyncDownload).toHaveBeenCalledWith(metadata.dataCid);
    expect(onAsyncDownloadsRefresh).toHaveBeenCalled();
    expect(onPhaseChange.mock.calls.map(([phase]) => phase)).toEqual([
      'checking',
      'preparing',
      'downloading',
      'completed',
    ]);
    expect(downloadService.fetchFile).toHaveBeenCalledTimes(1);
  });

  it('falls back to direct download when async creation fails', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue({
      accessToken: 'token',
      authProvider: 'google',
    });
    const { api, downloadService } = createDependencies();
    api.checkDownloadStatus.mockResolvedValueOnce(DownloadStatus.NotCached);
    api.createAsyncDownload.mockRejectedValue(new Error('queue unavailable'));

    await runObjectDownloadFlow({
      api: api as never,
      downloadService,
      metadata: metadata as never,
      asyncPollIntervalMs: 0,
    });

    expect(downloadService.fetchFile).toHaveBeenCalledTimes(1);
  });

  it('surfaces async preparation failures from the async downloads store', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue({
      accessToken: 'token',
      authProvider: 'google',
    });
    const { api, downloadService } = createDependencies();
    api.checkDownloadStatus
      .mockResolvedValueOnce(DownloadStatus.NotCached)
      .mockResolvedValueOnce(DownloadStatus.NotCached);

    await expect(
      runObjectDownloadFlow({
        api: api as never,
        downloadService,
        metadata: metadata as never,
        asyncPollIntervalMs: 0,
        getAsyncDownloads: () => [
          {
            cid: metadata.dataCid,
            status: AsyncDownloadStatus.Failed,
            errorMessage: 'Gateway timed out',
          },
        ],
      }),
    ).rejects.toThrow('Gateway timed out');

    expect(downloadService.fetchFile).not.toHaveBeenCalled();
  });

  it('downloads directly for anonymous users', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue(null);
    const { api, downloadService } = createDependencies();

    await runObjectDownloadFlow({
      api: api as never,
      downloadService,
      metadata: metadata as never,
    });

    expect(api.checkDownloadStatus).not.toHaveBeenCalled();
    expect(api.createAsyncDownload).not.toHaveBeenCalled();
    expect(downloadService.fetchFile).toHaveBeenCalledTimes(1);
  });

  it('throws ObjectDownloadPreparationError when async polling times out', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue({
      accessToken: 'token',
      authProvider: 'google',
    });
    const { api, downloadService } = createDependencies();
    // initial check → NotCached triggers async creation; every subsequent
    // poll also returns NotCached, exhausting maxAsyncPollCount.
    api.checkDownloadStatus.mockResolvedValue(DownloadStatus.NotCached);

    await expect(
      runObjectDownloadFlow({
        api: api as never,
        downloadService,
        metadata: metadata as never,
        asyncPollIntervalMs: 0,
        maxAsyncPollCount: 3,
      }),
    ).rejects.toThrow('Download preparation timed out');

    expect(api.createAsyncDownload).toHaveBeenCalledTimes(1);
    expect(downloadService.fetchFile).not.toHaveBeenCalled();
  });

  it('aborts mid-poll when the AbortSignal fires', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue({
      accessToken: 'token',
      authProvider: 'google',
    });
    const { api, downloadService } = createDependencies();
    api.checkDownloadStatus.mockResolvedValue(DownloadStatus.NotCached);

    const controller = new AbortController();
    const flow = runObjectDownloadFlow({
      api: api as never,
      downloadService,
      metadata: metadata as never,
      asyncPollIntervalMs: 100,
      maxAsyncPollCount: 10,
      signal: controller.signal,
    });

    // give the flow a chance to enter its first delay()
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await expect(flow).rejects.toThrow('Download aborted');
    expect(downloadService.fetchFile).not.toHaveBeenCalled();
  });

  it('aborts after fetchFile completes if signal fired mid-download', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue(null);
    const { api, downloadService } = createDependencies();

    const controller = new AbortController();
    downloadService.fetchFile.mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });

    const onPhaseChange = jest.fn();

    await expect(
      runObjectDownloadFlow({
        api: api as never,
        downloadService,
        metadata: metadata as never,
        signal: controller.signal,
        onPhaseChange,
      }),
    ).rejects.toThrow('Download aborted');

    expect(downloadService.fetchFile).toHaveBeenCalledTimes(1);
    expect(onPhaseChange).toHaveBeenCalledWith('downloading');
    expect(onPhaseChange).not.toHaveBeenCalledWith('completed');
  });

  it('tolerates a transient poll-cycle error and continues polling', async () => {
    (getAuthSession as jest.Mock).mockResolvedValue({
      accessToken: 'token',
      authProvider: 'google',
    });
    const { api, downloadService } = createDependencies();
    // 1st call (pre-async): NotCached
    // 2nd call (1st poll): rejects with transient error → swallowed
    // 3rd call (2nd poll): Cached → flow proceeds to download
    api.checkDownloadStatus
      .mockResolvedValueOnce(DownloadStatus.NotCached)
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(DownloadStatus.Cached);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await runObjectDownloadFlow({
      api: api as never,
      downloadService,
      metadata: metadata as never,
      asyncPollIntervalMs: 0,
      maxAsyncPollCount: 5,
    });

    expect(downloadService.fetchFile).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toContain('poll cycle');

    warnSpy.mockRestore();
  });
});
