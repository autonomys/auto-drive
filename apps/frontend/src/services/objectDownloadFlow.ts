import { OffchainMetadata } from '@autonomys/auto-dag-data';
import { AsyncDownloadStatus, DownloadStatus } from '@auto-drive/models';
import { Api } from 'services/api';
import { DownloadApi, DownloadOptions } from 'services/download';
import { getAuthSession } from '@/utils/auth';

const ASYNC_POLL_INTERVAL_MS = 5_000;

/**
 * Upper bound on waiting for a reconstruction, as a backstop against polling
 * forever if the server loses the job without recording a failure.
 *
 * This used to be 10 minutes (60 polls x 10s), against a retrieval path the
 * codebase itself documents as taking 20+ minutes for a non-cached archived
 * file. The client gave up first and reported "Download preparation timed out",
 * so a healthy-but-slow reconstruction was indistinguishable from a broken one
 * and the user concluded the file was gone. Two hours is far past any observed
 * reconstruction, and progress reporting means the user is no longer staring at
 * an unchanging spinner while it runs.
 */
const MAX_ASYNC_WAIT_MS = 2 * 60 * 60 * 1000;

export type ObjectDownloadPhase =
  | 'checking'
  | 'preparing'
  | 'downloading'
  | 'completed';

export interface ObjectDownloadPreparationProgress {
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
  elapsedMs: number;
}

export class ObjectDownloadAbortedError extends Error {
  constructor() {
    super('Download aborted');
  }
}

/** The server gave a terminal verdict: this retrieval will not complete. */
class ObjectDownloadPreparationError extends Error {}

/**
 * The caller stopped waiting, but the server has not failed — the
 * reconstruction is still running and will finish on its own.
 *
 * Distinct from ObjectDownloadPreparationError so callers can say "still
 * coming, we'll grab it when it lands" instead of "failed". Bulk downloads in
 * particular need this: they run one item at a time, so they wait briefly and
 * then hand the slow item to the background auto-download machinery rather
 * than holding up everything behind it.
 */
export class ObjectDownloadStillPreparingError extends Error {}

export interface ObjectDownloadFlowOptions {
  api: Api;
  downloadService: DownloadApi;
  metadata: OffchainMetadata;
  password?: string;
  skipDecryption?: boolean;
  signal?: AbortSignal;
  onProgress?: DownloadOptions['onProgress'];
  onPhaseChange?: (phase: ObjectDownloadPhase) => void;
  onPreparationProgress?: (progress: ObjectDownloadPreparationProgress) => void;
  onAsyncDownloadsRefresh?: () => void;
  getAsyncDownloads?: () => {
    cid: string;
    status: AsyncDownloadStatus;
    errorMessage?: string | null;
  }[];
  maxAsyncWaitMs?: number;
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
  onPreparationProgress,
  onAsyncDownloadsRefresh,
  getAsyncDownloads,
  maxAsyncWaitMs = MAX_ASYNC_WAIT_MS,
  asyncPollIntervalMs = ASYNC_POLL_INTERVAL_MS,
}: ObjectDownloadFlowOptions) => {
  assertNotAborted(signal);
  onPhaseChange?.('checking');

  const session = await getAuthSession().catch(() => null);
  assertNotAborted(signal);
  const hasSession = !!session?.accessToken && !!session?.authProvider;

  // The cache is the fast source and the only one that answers immediately, so
  // it decides the route: a hit streams straight through, a miss goes via a
  // server-side reconstruction we can actually report on.
  //
  // A failed check no longer silently disables preparation. It used to set
  // shouldPrepareAsync = false and fall through to a direct fetch — which, for
  // an uncached file, is the request that sits silent until a proxy or the
  // browser gives up. Assume the pessimistic answer instead: if we cannot
  // confirm the file is cached, treat it as needing preparation.
  let isCached = false;
  try {
    const availability = await api.checkDownloadAvailability(metadata.dataCid);
    assertNotAborted(signal);
    isCached = availability.status === DownloadStatus.Cached;
  } catch (error) {
    if (error instanceof ObjectDownloadAbortedError) {
      throw error;
    }
    isCached = false;
  }

  // Queuing a reconstruction needs a session. Anonymous callers fall through to
  // the direct download, which now holds while the server reconstructs rather
  // than being cut short — slower, but it completes, and it is the only route
  // available to them.
  let preparing = !isCached && hasSession;

  if (preparing) {
    onPhaseChange?.('preparing');
    try {
      // Idempotent server-side: a repeat call joins the run already in flight
      // instead of starting a competing one.
      await api.createAsyncDownload(metadata.dataCid);
      onAsyncDownloadsRefresh?.();
    } catch (error) {
      if (error instanceof ObjectDownloadAbortedError) {
        throw error;
      }
      preparing = false;
      onPhaseChange?.('checking');
    }
  }

  if (preparing) {
    const startedAt = Date.now();

    for (;;) {
      await delay(asyncPollIntervalMs, signal);
      assertNotAborted(signal);

      let ready = false;
      try {
        const availability = await api.checkDownloadAvailability(
          metadata.dataCid,
        );
        onAsyncDownloadsRefresh?.();
        assertNotAborted(signal);

        if (availability.status === DownloadStatus.Cached) {
          ready = true;
        } else {
          const reconstruction = availability.reconstruction;
          if (reconstruction) {
            const totalBytes = Number(reconstruction.totalSize ?? 0);
            const downloadedBytes = Number(reconstruction.downloadedBytes ?? 0);
            onPreparationProgress?.({
              downloadedBytes,
              totalBytes,
              // Guarded: totalSize is 0 for an empty object and null on rows
              // written before the size was recorded, and an unguarded divide
              // renders NaN% into the one screen the user is watching.
              percentage:
                totalBytes > 0
                  ? Math.min(
                      100,
                      Math.floor((downloadedBytes * 100) / totalBytes),
                    )
                  : 0,
              elapsedMs: Date.now() - startedAt,
            });
          }

          // Only a terminal server-side verdict ends the wait. A job that is
          // merely slow is not a failure, and must not be reported as one.
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
                'The server could not retrieve this file from the network. Please try again.',
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
        // whole flow — we'll retry next cycle or hit the backstop. Surface
        // for debugging so a fully broken gateway doesn't fail silently.
        console.warn(
          `[objectDownloadFlow] poll failed for ${metadata.dataCid}; continuing`,
          error,
        );
      }

      if (ready) {
        break;
      }

      if (Date.now() - startedAt >= maxAsyncWaitMs) {
        throw new ObjectDownloadStillPreparingError(
          'This file is still being retrieved from the network. It will keep going in the background — check Cached Downloads for progress.',
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
