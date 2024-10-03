import { FolderTree } from "../models/FileTree";
import { UploadedObjectMetadata } from "../models/UploadedObjectMetadata";
import { getAuthSession } from "../utils/auth";
import { uploadFileContent } from "../utils/file";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface UploadResponse {
  cid: string;
}

export const ApiService = {
  uploadFile: async (file: File): Promise<UploadResponse> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/objects/file`, {
      method: "POST",
      body: JSON.stringify({
        data: await uploadFileContent(file),
        filename: file.name,
        mimeType: file.type,
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  uploadFolder: async (
    tree: FolderTree,
    files: Record<string, File>
  ): Promise<UploadResponse> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    console.log("uploading folder", tree, files);

    const formData = new FormData();

    formData.append("folderTree", JSON.stringify(tree));
    Object.entries(files).forEach(([fileId, file]) => {
      formData.append(fileId, file);
    });

    const response = await fetch(`${API_BASE_URL}/objects/folder`, {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  fetchUploadedObjectMetadata: async (
    cid: string
  ): Promise<UploadedObjectMetadata> => {
    const response = await fetch(`${API_BASE_URL}/objects/${cid}`);

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  fetchDataURL: (cid: string): string => {
    return `${API_BASE_URL}/objects/${cid}/download`;
  },
  searchHeadCID: async (
    query: string,
    scope: "user" | "global"
  ): Promise<string[]> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(
      `${API_BASE_URL}/objects/search?query=${query}&scope=${scope}`,
      {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
          "X-Auth-Provider": "google",
        },
      }
    );
    return response.json();
  },
  getRootObjects: async (scope: "user" | "global"): Promise<string[]> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(
      `${API_BASE_URL}/objects/roots?scope=${scope}`,
      {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
          "X-Auth-Provider": "google",
        },
      }
    );

    return response.json();
  },
};
