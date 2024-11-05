import { constructZipBlob, FolderTree } from "../models/FileTree";
import { asyncByChunk, fileToIterable } from "../utils/async";
import { getAuthSession } from "../utils/auth";
import {
  compressFileByChunks,
  COMPRESSION_CHUNK_SIZE,
} from "../utils/compression";
import { ENCRYPTING_CHUNK_SIZE, encryptFile } from "../utils/encryption";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type CreationUploadResponse = {
  id: string;
};

const createFileUpload = async (
  file: File,
  { encryption, compression }: { encryption: boolean; compression: boolean }
): Promise<CreationUploadResponse> => {
  const session = await getAuthSession();
  if (!session?.provider || !session.accessToken) {
    throw new Error("No session");
  }

  return fetch(`${API_BASE_URL}/uploads/file`, {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type,
      uploadOptions: {
        encryption: encryption
          ? {
              algorithm: "AES_256_GCM",
              chunkSize: ENCRYPTING_CHUNK_SIZE,
            }
          : undefined,
        compression: compression
          ? {
              algorithm: "ZLIB",
              level: 9,
              chunkSize: COMPRESSION_CHUNK_SIZE,
            }
          : undefined,
      },
    }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      "X-Auth-Provider": session.provider,
    },
  }).then((e) => {
    if (!e.ok) {
      throw new Error("Failed to create file upload");
    }

    return e.json() as Promise<CreationUploadResponse>;
  });
};

const uploadFileChunk = async (
  uploadId: string,
  chunk: Blob,
  index: number
) => {
  const session = await getAuthSession();
  if (!session?.provider || !session.accessToken) {
    throw new Error("No session");
  }

  const formData = new FormData();
  formData.append("file", chunk);
  formData.append("index", index.toString());
  return fetch(`${API_BASE_URL}/uploads/file/${uploadId}/chunk`, {
    method: "POST",
    body: formData,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "X-Auth-Provider": session.provider,
    },
  });
};

const completeUpload = async (uploadId: string) => {
  const session = await getAuthSession();
  if (!session?.provider || !session.accessToken) {
    throw new Error("No session");
  }

  return fetch(`${API_BASE_URL}/uploads/${uploadId}/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "X-Auth-Provider": session.provider,
    },
  }).then((e) => {
    if (!e.ok) {
      throw new Error("Failed to complete file upload");
    }
  });
};

const createFolderUpload = async (
  fileTree: FolderTree,
  { compression }: { compression: boolean }
) => {
  const session = await getAuthSession();
  if (!session?.provider || !session.accessToken) {
    throw new Error("No session");
  }

  return fetch(`${API_BASE_URL}/uploads/folder`, {
    method: "POST",
    body: JSON.stringify({
      fileTree,
      name: fileTree.name,
      uploadOptions: {
        encryption: undefined,
        compression: compression
          ? {
              algorithm: "ZLIB",
              level: 9,
            }
          : undefined,
      },
    }),
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "X-Auth-Provider": session.provider,
      "Content-Type": "application/json",
    },
  }).then((e) => {
    if (!e.ok) {
      throw new Error("Failed to create folder upload");
    }

    return e.json() as Promise<CreationUploadResponse>;
  });
};

const createEncryptedFolderUpload = async function* (
  tree: FolderTree,
  files: Record<string, File>,
  password: string
): AsyncIterable<number> {
  const zip = await constructZipBlob(tree, files);

  const iterable = uploadFile(new File([zip], `${tree.name}.zip`), {
    password,
    compress: false,
  });

  for await (const progress of iterable) {
    yield progress;
  }
};

const createFileUploadWithinFolderUpload = async (
  rootUploadId: string,
  relativeId: string,
  file: File,
  { encryption, compression }: { encryption: boolean; compression: boolean }
) => {
  const session = await getAuthSession();
  if (!session?.provider || !session.accessToken) {
    throw new Error("No session");
  }

  return fetch(`${API_BASE_URL}/uploads/folder/${rootUploadId}/file`, {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type,
      relativeId,
      uploadOptions: {
        encryption: encryption
          ? {
              algorithm: "AES_256_GCM",
              chunkSize: ENCRYPTING_CHUNK_SIZE,
            }
          : undefined,
        compression: compression
          ? {
              algorithm: "ZLIB",
              level: 9,
              chunkSize: COMPRESSION_CHUNK_SIZE,
            }
          : undefined,
      },
    }),
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "X-Auth-Provider": session.provider,
      "Content-Type": "application/json",
    },
  }).then((e) => {
    if (!e.ok) {
      throw new Error("Failed to create file upload within folder upload");
    }

    return e.json() as Promise<CreationUploadResponse>;
  });
};

const uploadFileChunks = async function* (
  uploadId: string,
  file: AsyncIterable<Buffer>
): AsyncIterable<number> {
  let byteCount = 0;
  let chunkCount = 0;
  const chunkSize = 20 * 1024 * 1024;
  for await (const chunk of asyncByChunk(file, chunkSize)) {
    await uploadFileChunk(uploadId, new Blob([chunk]), chunkCount);

    byteCount += chunk.length;
    chunkCount++;

    yield byteCount;
  }
};

const fileToParsedIterable = async function* (
  file: File,
  { password, compress }: { password?: string; compress?: boolean }
): AsyncIterable<Buffer> {
  const fileIterable = fileToIterable(file);
  let mappers: ((file: AsyncIterable<Buffer>) => AsyncIterable<Buffer>)[] = [];
  if (compress) {
    mappers.push(compressFileByChunks);
  }
  if (password) {
    mappers.push((file) => encryptFile(file, password));
  }

  for await (const chunk of mappers.reduce(
    (file, mapper) => mapper(file),
    fileIterable
  )) {
    yield chunk;
  }
};

const uploadFile = async function* (
  file: File,
  { password, compress }: { password?: string; compress?: boolean } = {}
): AsyncIterable<number> {
  const upload = await createFileUpload(file, {
    encryption: !!password,
    compression: !!compress,
  });

  const processedIterable = fileToParsedIterable(file, { password, compress });

  for await (const chunkProgress of uploadFileChunks(
    upload.id,
    processedIterable
  )) {
    yield (100 * chunkProgress) / file.size;
  }

  await completeUpload(upload.id);

  return upload;
};

const uploadFolder = async function* (
  tree: FolderTree,
  files: Record<string, File>,
  { compress }: { compress?: boolean } = {}
): AsyncGenerator<number> {
  const totalSize = Object.values(files).reduce((acc, e) => acc + e.size, 0);
  const upload = await createFolderUpload(tree, {
    compression: !!compress,
  });
  let uploadedSize = 0;
  for (const [relativeId, file] of Object.entries(files)) {
    const fileUpload = await createFileUploadWithinFolderUpload(
      upload.id,
      relativeId,
      file,
      { encryption: false, compression: !!compress }
    );

    const processedIterable = fileToParsedIterable(file, {
      compress,
    });
    for await (const chunkProgress of uploadFileChunks(
      fileUpload.id,
      processedIterable
    )) {
      yield (100 * (uploadedSize + chunkProgress)) / totalSize;
    }
    await completeUpload(fileUpload.id);
    uploadedSize += file.size;
  }

  await completeUpload(upload.id);
};

export const UploadService = {
  uploadFile,
  uploadFolder,
  createEncryptedFolderUpload,
};
