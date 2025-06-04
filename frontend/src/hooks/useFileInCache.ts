import { useState, useEffect } from 'react';
import { useNetwork } from 'contexts/network';
import { DownloadStatus } from '@auto-drive/models';

/**
 * Hook to check if a file is available in the cache
 * @param cid Content identifier of the file
 * @returns boolean indicating if the file is cached
 */
export const useFileInCache = (cid: string): boolean => {
  const { api } = useNetwork();
  const [isCached, setIsCached] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;

    const checkCache = async () => {
      if (!cid) return;

      try {
        const status = await api.checkDownloadStatus(cid);
        if (mounted) {
          setIsCached(status === DownloadStatus.Cached);
        }
      } catch (error) {
        console.error('Error checking file cache status:', error);
        if (mounted) {
          setIsCached(false);
        }
      }
    };

    checkCache();

    return () => {
      mounted = false;
    };
  }, [cid, api]);

  return isCached;
};
