import { OffchainMetadata } from "@autonomys/auto-drive";
import { decryptFile } from "./encryption";
import { streamToAsyncIterable } from "./stream";
import { decompressFileByChunks } from "./compression";

export class InvalidDecryptKey extends Error {
  constructor() {
    super("Invalid decrypt key");
  }
}

export const uploadFileContent = (file: File) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      const data = base64Data.split(",")[1];
      resolve(data);
    };
    reader.readAsDataURL(file);
  });
};

export const handleFileDownload = async (
  stream: ReadableStream<Uint8Array>,
  type: OffchainMetadata["type"],
  name: string,
  {
    password,
    compress,
  }: {
    password?: string;
    compress?: boolean;
  } = {}
) => {
  const StreamSaver = await import("streamsaver");
  let writtenSize = 0;
  // Create a writable stream using StreamSaver
  const fileStream = StreamSaver.createWriteStream(
    type === "file" ? name : `${name}.zip`
  );
  const writer = fileStream.getWriter();

  try {
    let mappers: ((file: AsyncIterable<Buffer>) => AsyncIterable<Buffer>)[] =
      [];
    if (password) {
      mappers.push((file) => decryptFile(file, password));
    }
    if (compress) {
      mappers.push(decompressFileByChunks);
    }

    const reader = mappers.reduce(
      (file, mapper) => mapper(file),
      streamToAsyncIterable(stream.getReader())
    );

    for await (const chunk of reader) {
      await writer.write(chunk);
      writtenSize += chunk.length;
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (writtenSize === 0) {
      throw new InvalidDecryptKey();
    }
    writer.close();
  }
};

export const getTypeFromMetadata = (metadata: OffchainMetadata) => {
  if (metadata.type === "file") {
    return metadata.mimeType;
  }

  return "Folder";
};
