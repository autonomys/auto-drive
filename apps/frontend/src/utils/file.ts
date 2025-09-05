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

export const handleFileDownload = async (
  stream: AsyncIterable<Buffer>,
  writer: WritableStreamDefaultWriter<Buffer>,
): Promise<void> => {
  let writtenSize = 0;

  try {
    for await (const chunk of stream) {
      await writer.write(chunk);
      writtenSize += chunk.length;
    }
    writer.close();
  } catch {
    if (writtenSize === 0) {
      writer.abort();
      throw new InvalidDecryptKey();
    } else {
      writer.close();
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
