import { useState, useEffect } from 'react';
import { useNetwork } from 'contexts/network';
import { DownloadStatus } from '@auto-drive/models';

/**
 * Hook to check if a file is available in the cache.
 * @param cid Content identifier of the file.
 * @returns `true` if cached, `false` if not cached, `null` while the check is in flight.
 */
export const useFileInCache = (cid: string): boolean | null => {
  const { api } = useNetwork();
  const [isCached, setIsCached] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkCache = async () => {
      if (!cid) return;

      const status = await api.checkDownloadStatus(cid).catch(() => false);
      if (mounted) {
        setIsCached(status === DownloadStatus.Cached);
      }
    };

    checkCache();

    return () => {
      mounted = false;
    };
  }, [cid, api]);

  return isCached;
};
