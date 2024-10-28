import { OffchainMetadata } from "@autonomys/auto-drive";

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
  name: string
) => {
  const StreamSaver = await import("streamsaver");
  // Create a writable stream using StreamSaver
  const fileStream = StreamSaver.createWriteStream(
    type === "file" ? name : `${name}.zip`
  );
  const writer = fileStream.getWriter();
  const reader = stream.getReader();

  // Stream data directly from the response to the file
  try {
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (value) {
        await writer.write(value);
      }
      done = streamDone;
    }
  } catch (error) {
    console.error("Download failed:", error);
  } finally {
    // Close the writer when done
    await writer.close();
  }
};

export const getTypeFromMetadata = (metadata: OffchainMetadata) => {
  if (metadata.type === "file") {
    return metadata.mimeType;
  }

  return "Folder";
};
