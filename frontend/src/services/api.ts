import { ApiKey, ApiKeyWithoutSecret } from "../models/ApiKey";
import { FolderTree } from "../models/FileTree";
import { ObjectSearchResult } from "../models/ObjectSearchResult";
import {
  SubscriptionGranularity,
  SubscriptionWithUser,
} from "../models/Subscriptions";
import { UploadedObjectMetadata } from "../models/UploadedObjectMetadata";
import { User, UserInfo } from "../models/User";
import { getAuthSession } from "../utils/auth";
import { uploadFileContent } from "../utils/file";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface UploadResponse {
  cid: string;
}

export const ApiService = {
  getMe: async (): Promise<UserInfo> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/users/@me`, {
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
  getUserList: async (): Promise<SubscriptionWithUser[]> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/users/subscriptions/list`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });
    return response.json();
  },
  getApiKeysByUser: async (): Promise<ApiKeyWithoutSecret[]> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/apiKeys`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });

    return response.json();
  },
  deleteApiKey: async (apiKeyId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(
      `${API_BASE_URL}/users/@me/apiKeys/${apiKeyId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "X-Auth-Provider": "google",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
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
  downloadObject: async (cid: string): Promise<ReadableStream<Uint8Array>> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/objects/${cid}/download`, {
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.body;
  },
  searchByCIDOrName: async (
    query: string,
    scope: "user" | "global"
  ): Promise<ObjectSearchResult[]> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(
      `${API_BASE_URL}/objects/search?cid=${query}&scope=${scope}`,
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
  getSharedRoots: async (): Promise<string[]> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/objects/roots/shared`, {
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  getTrashObjects: async (): Promise<string[]> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/objects/roots/deleted`, {
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  generateApiKey: async (): Promise<ApiKey> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/apiKeys/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  shareObject: async (dataCid: string, publicId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    await fetch(`${API_BASE_URL}/objects/${dataCid}/share`, {
      method: "POST",
      body: JSON.stringify({ publicId }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
        "Content-Type": "application/json",
      },
    });
  },
  markObjectAsDeleted: async (cid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    await fetch(`${API_BASE_URL}/objects/${cid}/delete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });
  },
  restoreObject: async (cid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/objects/${cid}/restore`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  onboardUser: async (): Promise<User> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/onboard`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  addAdmin: async (publicId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/users/admin/add`, {
      method: "POST",
      body: JSON.stringify({ publicId }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  removeAdmin: async (publicId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/users/admin/remove`, {
      method: "POST",
      body: JSON.stringify({ publicId }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  updateSubscription: async (
    publicId: string,
    granularity: SubscriptionGranularity,
    uploadLimit: number,
    downloadLimit: number
  ): Promise<void> => {
    const session = await getAuthSession();
    if (!session) {
      throw new Error("No session");
    }

    const response = await fetch(`${API_BASE_URL}/users/subscriptions/update`, {
      method: "POST",
      body: JSON.stringify({
        granularity,
        uploadLimit,
        downloadLimit,
        publicId,
      }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        "X-Auth-Provider": "google",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
};
