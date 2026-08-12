import { useState, useEffect } from 'react';
import { useNetwork } from 'contexts/network';
import { DownloadStatus } from '@auto-drive/models';
import type { DownloadAvailability } from 'services/api';

const POLL_INTERVAL_MS = 10_000;

export interface FileCacheState {
  /** `true` if cached, `false` if not, `null` while the first check is in flight. */
  isCached: boolean | null;
  /** Server-side reconstruction in progress, if any. */
  reconstruction: DownloadAvailability['reconstruction'];
}

/**
 * Tracks whether a file can be served from cache, and whether a retrieval is
 * currently running for it.
 *
 * Polls rather than checking once: a reconstruction takes minutes, so a
 * single check on mount meant "Bring to Cache" stayed on screen for the whole
 * run and then stayed on screen after it finished, with nothing to tell the
 * user either had happened.
 */
export const useFileCacheState = (cid: string): FileCacheState => {
  const { api } = useNetwork();
  const [state, setState] = useState<FileCacheState>({
    isCached: null,
    reconstruction: null,
  });

  useEffect(() => {
    if (!cid) return;

    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        const availability = await api.checkDownloadAvailability(cid);
        if (!mounted) return;
        setState({
          isCached: availability.status === DownloadStatus.Cached,
          reconstruction: availability.reconstruction,
        });
      } catch {
        // Leave the last known state alone on a transient failure — flipping to
        // "not cached" on a network blip would make the file look unavailable.
        if (!mounted) return;
        setState((current) =>
          current.isCached === null
            ? { isCached: false, reconstruction: null }
            : current,
        );
      }

      if (mounted) {
        timer = setTimeout(check, POLL_INTERVAL_MS);
      }
    };

    check();

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [cid, api]);

  return state;
};

/**
 * @returns `true` if cached, `false` if not cached, `null` while the check is in flight.
 */
export const useFileInCache = (cid: string): boolean | null =>
  useFileCacheState(cid).isCached;
