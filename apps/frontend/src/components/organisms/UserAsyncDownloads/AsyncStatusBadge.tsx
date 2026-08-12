import { AsyncDownload, AsyncDownloadStatus } from '@auto-drive/models';
import { useMemo } from 'react';

const getStatusColor = (status: AsyncDownloadStatus) => {
  switch (status) {
    case AsyncDownloadStatus.Completed:
      return 'bg-blue-100 text-blue-800';
    case AsyncDownloadStatus.Failed:
      return 'bg-yellow-100 text-yellow-800';
    case AsyncDownloadStatus.Dismissed:
      return 'bg-purple-100 text-purple-800';
    case AsyncDownloadStatus.Pending:
      return 'bg-green-100 text-green-800';
    case AsyncDownloadStatus.Downloading:
      return 'bg-green-100 text-green-800';
  }
};

const getStatusLabel = (download: AsyncDownload) => {
  // `?? 0` does not cover a stored '0' — and BigInt division by zero throws a
  // RangeError, which escapes render and takes the whole Cached Downloads
  // dialog down with it. A zero-byte object, or a row written before the size
  // was known, was enough to break the one screen showing download state.
  const totalBytes = BigInt(download.fileSize || 0);
  const progress =
    totalBytes > BigInt(0)
      ? Math.floor(
          Number((BigInt(100) * BigInt(download.downloadedBytes || 0)) / totalBytes),
        )
      : 0;
  switch (download.status) {
    case AsyncDownloadStatus.Completed:
      return 'Completed';
    case AsyncDownloadStatus.Failed:
      return 'Failed';
    case AsyncDownloadStatus.Dismissed:
      return 'Dismissed';
    case AsyncDownloadStatus.Pending:
      return 'Pending';
    case AsyncDownloadStatus.Downloading:
      return `Downloading (${progress}%)`;
  }
};

export const AsyncStatusBadge = ({ download }: { download: AsyncDownload }) => {
  const color = useMemo(
    () => getStatusColor(download.status),
    [download.status],
  );
  const label = useMemo(() => getStatusLabel(download), [download]);

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
};
