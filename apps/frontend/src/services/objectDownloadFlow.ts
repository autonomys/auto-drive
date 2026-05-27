import { OffchainMetadata } from '@autonomys/auto-dag-data';
import { AsyncDownloadStatus, DownloadStatus } from '@auto-drive/models';
import { Api } from 'services/api';
import { DownloadApi, DownloadOptions } from 'services/download';
import { getAuthSession } from '@/utils/auth';

const MAX_ASYNC_POLL_COUNT = 60;
const ASYNC_POLL_INTERVAL_MS = 10_000;

export type ObjectDownloadPhase =
  | 'checking'
  | 'preparing'
  | 'downloading'
  | 'completed';

export class ObjectDownloadAbortedError extends Error {
  constructor() {
    super('Download aborted');
  }
}

class ObjectDownloadPreparationError extends Error {}

export interface ObjectDownloadFlowOptions {
  api: Api;
  downloadService: DownloadApi;
  metadata: OffchainMetadata;
  password?: string;
  skipDecryption?: boolean;
  signal?: AbortSignal;
  onProgress?: DownloadOptions['onProgress'];
  onPhaseChange?: (phase: ObjectDownloadPhase) => void;
  onAsyncDownloadsRefresh?: () => void;
  getAsyncDownloads?: () => {
    cid: string;
    status: AsyncDownloadStatus;
    errorMessage?: string | null;
  }[];
  maxAsyncPollCount?: number;
  asyncPollIntervalMs?: number;
}

const assertNotAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new ObjectDownloadAbortedError();
  }
};

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ObjectDownloadAbortedError());
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new ObjectDownloadAbortedError());
      },
      { once: true },
    );
  });

export const runObjectDownloadFlow = async ({
  api,
  downloadService,
  metadata,
  password,
  skipDecryption = false,
  signal,
  onProgress,
  onPhaseChange,
  onAsyncDownloadsRefresh,
  getAsyncDownloads,
  maxAsyncPollCount = MAX_ASYNC_POLL_COUNT,
  asyncPollIntervalMs = ASYNC_POLL_INTERVAL_MS,
}: ObjectDownloadFlowOptions) => {
  assertNotAborted(signal);
  onPhaseChange?.('checking');

  let shouldPrepareAsync = false;
  try {
    const session = await getAuthSession().catch(() => null);
    assertNotAborted(signal);
    const hasSession = !!session?.accessToken && !!session?.authProvider;

    if (hasSession) {
      const status = await api.checkDownloadStatus(metadata.dataCid);
      assertNotAborted(signal);
      shouldPrepareAsync = status === DownloadStatus.NotCached;
    }
  } catch (error) {
    if (error instanceof ObjectDownloadAbortedError) {
      throw error;
    }
    shouldPrepareAsync = false;
  }

  if (shouldPrepareAsync) {
    onPhaseChange?.('preparing');
    try {
      await api.createAsyncDownload(metadata.dataCid);
      onAsyncDownloadsRefresh?.();
    } catch (error) {
      if (error instanceof ObjectDownloadAbortedError) {
        throw error;
      }
      shouldPrepareAsync = false;
      onPhaseChange?.('checking');
    }
  }

  if (shouldPrepareAsync) {
    for (let pollCount = 0; pollCount < maxAsyncPollCount; pollCount++) {
      await delay(asyncPollIntervalMs, signal);
      assertNotAborted(signal);

      let isCached = false;
      try {
        const status = await api.checkDownloadStatus(metadata.dataCid);
        onAsyncDownloadsRefresh?.();
        assertNotAborted(signal);
        if (status === DownloadStatus.Cached) {
          isCached = true;
        } else {
          const matchingDownload = getAsyncDownloads?.().find(
            (d) => d.cid === metadata.dataCid,
          );
          if (
            matchingDownload &&
            (matchingDownload.status === AsyncDownloadStatus.Failed ||
              matchingDownload.status === AsyncDownloadStatus.Dismissed)
          ) {
            throw new ObjectDownloadPreparationError(
              matchingDownload.errorMessage ||
                'Download failed on the server. Please try again.',
            );
          }
        }
      } catch (error) {
        if (error instanceof ObjectDownloadAbortedError) {
          throw error;
        }

        if (error instanceof ObjectDownloadPreparationError) {
          throw error;
        }

        // Transient poll-cycle failure (e.g. network blip). Don't fail the
        // whole flow — we'll retry next cycle or hit the timeout. Surface
        // for debugging so a fully broken gateway doesn't fail silently.
        console.warn(
          `[objectDownloadFlow] poll cycle ${pollCount + 1}/${maxAsyncPollCount} failed for ${metadata.dataCid}; continuing`,
          error,
        );
      }

      if (isCached) {
        break;
      }

      if (pollCount === maxAsyncPollCount - 1) {
        throw new ObjectDownloadPreparationError(
          'Download preparation timed out. Please try again later.',
        );
      }
    }
  }

  assertNotAborted(signal);
  onPhaseChange?.('downloading');
  await downloadService.fetchFile(metadata.dataCid, {
    password: skipDecryption ? undefined : password,
    skipDecryption,
    onProgress,
  });
  assertNotAborted(signal);
  onPhaseChange?.('completed');
};
