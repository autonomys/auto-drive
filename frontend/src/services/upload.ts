import { FolderTree } from "../models/FileTree";
import { asyncByChunk, fileToIterable } from "../utils/async";
import { getAuthSession } from "../utils/auth";
import { compressFileByChunks } from "../utils/compression";
import { encryptFile } from "../utils/encryption";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type CreationUploadResponse = {
  id: string;
};

const createFileUpload = async (
  file: File,
  { encryption, compression }: { encryption: boolean; compression: boolean }
): Promise<CreationUploadResponse> => {
  const session = await getAuthSession();
  if (!session) {
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
            }
          : undefined,
        compression: compression
          ? {
              algorithm: "ZLIB",
              level: 9,
            }
          : undefined,
      },
    }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      "X-Auth-Provider": "google",
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
  if (!session) {
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
      "X-Auth-Provider": "google",
    },
  });
};

const completeUpload = async (uploadId: string) => {
  const session = await getAuthSession();
  if (!session) {
    throw new Error("No session");
  }

  return fetch(`${API_BASE_URL}/uploads/${uploadId}/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "X-Auth-Provider": "google",
    },
  }).then((e) => {
    if (!e.ok) {
      throw new Error("Failed to complete file upload");
    }
  });
};

const createFolderUpload = async (
  fileTree: FolderTree,
  { encryption, compression }: { encryption: boolean; compression: boolean }
) => {
  const session = await getAuthSession();
  if (!session) {
    throw new Error("No session");
  }

  return fetch(`${API_BASE_URL}/uploads/folder`, {
    method: "POST",
    body: JSON.stringify({
      fileTree,
      name: fileTree.name,
      uploadOptions: {
        encryption: encryption
          ? {
              algorithm: "AES_256_GCM",
            }
          : undefined,
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
      "X-Auth-Provider": "google",
      "Content-Type": "application/json",
    },
  }).then((e) => {
    if (!e.ok) {
      throw new Error("Failed to create folder upload");
    }

    return e.json() as Promise<CreationUploadResponse>;
  });
};

const createFileUploadWithinFolderUpload = async (
  rootUploadId: string,
  relativeId: string,
  file: File,
  { encryption, compression }: { encryption: boolean; compression: boolean }
) => {
  const session = await getAuthSession();
  if (!session) {
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
            }
          : undefined,
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
      "X-Auth-Provider": "google",
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
  const chunkSize = 1024 * 1024;
  let index = 0;
  for await (const chunk of asyncByChunk(file, chunkSize)) {
    await uploadFileChunk(uploadId, new Blob([chunk]), index);

    index++;
    yield index;
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
) {
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
  { password, compress }: { password?: string; compress?: boolean } = {}
): AsyncGenerator<number> {
  const totalSize = Object.values(files).reduce((acc, e) => acc + e.size, 0);
  const upload = await createFolderUpload(tree, {
    encryption: !!password,
    compression: !!compress,
  });
  let uploadedSize = 0;
  for (const [relativeId, file] of Object.entries(files)) {
    const fileUpload = await createFileUploadWithinFolderUpload(
      upload.id,
      relativeId,
      file,
      { encryption: !!password, compression: !!compress }
    );

    const processedIterable = fileToParsedIterable(file, {
      password,
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
};
