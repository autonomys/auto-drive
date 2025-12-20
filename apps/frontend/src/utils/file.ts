import { OffchainMetadata } from '@autonomys/auto-dag-data';

export class InvalidDecryptKey extends Error {
  constructor() {
    super('Invalid decrypt key');
  }
}

export const uploadFileContent = (file: File) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      const data = base64Data.split(',')[1];
      resolve(data);
    };
    reader.readAsDataURL(file);
  });
};

export interface DownloadProgressInfo {
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
}

export type DownloadProgressCallback = (progress: DownloadProgressInfo) => void;

const PROGRESS_THROTTLE_MS = 100;

export const handleFileDownload = async (
  stream: AsyncIterable<Buffer>,
  writer: WritableStreamDefaultWriter<Buffer>,
  options?: {
    totalSize?: number;
    onProgress?: DownloadProgressCallback;
  },
): Promise<void> => {
  let writtenSize = 0;
  const { totalSize, onProgress } = options ?? {};
  let lastProgressUpdate = 0;

  const reportProgress = (force = false) => {
    if (!onProgress) return;

    const now = Date.now();
    if (force || now - lastProgressUpdate >= PROGRESS_THROTTLE_MS) {
      lastProgressUpdate = now;
      onProgress({
        downloadedBytes: writtenSize,
        totalBytes: totalSize ?? null,
        percentage:
          typeof totalSize === 'number' && totalSize > 0
            ? Math.round((writtenSize / totalSize) * 100)
            : null,
      });
    }
  };

  try {
    for await (const chunk of stream) {
      await writer.write(chunk);
      writtenSize += chunk.length;
      reportProgress();
    }
    reportProgress(true);
    writer.close();
  } catch (error) {
    if (writtenSize === 0) {
      writer.abort();
      throw new InvalidDecryptKey();
    } else {
      console.error('Download error after writing bytes:', writtenSize, error);
      writer.close();
      throw error;
    }
  }
};

export const getTypeFromMetadata = (metadata: {
  type: OffchainMetadata['type'];
  mimeType?: string;
}) => {
  if (metadata.type === 'file') {
    return metadata.mimeType;
  }

  return 'Folder';
};
