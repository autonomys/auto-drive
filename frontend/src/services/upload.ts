import { FolderTree } from "../models/FileTree";
import { getAuthSession } from "../utils/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type CreationUploadResponse = {
  id: string;
};

const createFileUpload = async (
  file: File
): Promise<CreationUploadResponse> => {
  const session = await getAuthSession();
  if (!session) {
    throw new Error("No session");
  }

  return fetch(`${API_BASE_URL}/uploads/file`, {
    method: "POST",
    body: JSON.stringify({ filename: file.name, mimeType: file.type }),
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

const createFolderUpload = async (fileTree: FolderTree) => {
  const session = await getAuthSession();
  if (!session) {
    throw new Error("No session");
  }

  return fetch(`${API_BASE_URL}/uploads/folder`, {
    method: "POST",
    body: JSON.stringify({ fileTree, name: fileTree.name }),
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
  file: File
) => {
  const session = await getAuthSession();
  if (!session) {
    throw new Error("No session");
  }

  return fetch(`${API_BASE_URL}/uploads/folder/${rootUploadId}/file`, {
    method: "POST",
    body: JSON.stringify({ name: file.name, mimeType: file.type, relativeId }),
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
  file: File
): AsyncIterable<number> {
  const chunkSize = 1024 * 1024;
  for (let i = 0; i < file.size; i += chunkSize) {
    await uploadFileChunk(
      uploadId,
      file.slice(i, i + chunkSize),
      i / chunkSize
    );
    yield i;
  }
};

const uploadFile = async function* (file: File) {
  const upload = await createFileUpload(file);

  for await (const chunkProgress of uploadFileChunks(upload.id, file)) {
    yield (100 * chunkProgress) / file.size;
  }

  await completeUpload(upload.id);

  return upload;
};

const uploadFolder = async function* (
  tree: FolderTree,
  files: Record<string, File>
): AsyncGenerator<number> {
  const totalSize = Object.values(files).reduce((acc, e) => acc + e.size, 0);
  const upload = await createFolderUpload(tree);
  let uploadedSize = 0;
  for (const [relativeId, file] of Object.entries(files)) {
    const fileUpload = await createFileUploadWithinFolderUpload(
      upload.id,
      relativeId,
      file
    );
    for await (const chunkProgress of uploadFileChunks(fileUpload.id, file)) {
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
