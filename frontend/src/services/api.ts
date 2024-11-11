import {
  AuthProvider,
  createAutoDriveApi,
  downloadFile,
} from '@autonomys/auto-drive';
import { ApiKey, ApiKeyWithoutSecret } from '../models/ApiKey';
import { PaginatedResult } from '../models/common';
import { ObjectSearchResult } from '../models/ObjectSearchResult';
import {
  SubscriptionGranularity,
  SubscriptionWithUser,
} from '../models/Subscriptions';
import {
  ObjectSummary,
  UploadedObjectMetadata,
} from '../models/UploadedObjectMetadata';
import { User, UserInfo } from '../models/User';
import { getAuthSession } from '../utils/auth';
import { uploadFileContent } from '../utils/file';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export interface UploadResponse {
  cid: string;
}

export const ApiService = {
  getMe: async (): Promise<UserInfo> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.provider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  getUserList: async (): Promise<SubscriptionWithUser[]> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/subscriptions/list`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.provider,
      },
    });
    return response.json();
  },
  getApiKeysByUser: async (): Promise<ApiKeyWithoutSecret[]> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/apiKeys`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.provider,
      },
    });

    return response.json();
  },
  deleteApiKey: async (apiKeyId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${API_BASE_URL}/users/@me/apiKeys/${apiKeyId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.provider,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  uploadFile: async (file: File): Promise<UploadResponse> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/objects/file`, {
      method: 'POST',
      body: JSON.stringify({
        data: await uploadFileContent(file),
        filename: file.name,
        mimeType: file.type,
      }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.provider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  fetchUploadedObjectMetadata: async (
    cid: string,
  ): Promise<UploadedObjectMetadata> => {
    const response = await fetch(`${API_BASE_URL}/objects/${cid}`);

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  downloadObject: async (
    cid: string,
    password?: string,
  ): Promise<AsyncIterable<Buffer>> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const api = createAutoDriveApi({
      url: API_BASE_URL,
      provider: session.provider as AuthProvider,
      apiKey: session.accessToken,
    });

    return downloadFile(api, cid, password);
  },
  searchByCIDOrName: async (
    query: string,
    scope: 'user' | 'global',
  ): Promise<ObjectSearchResult[]> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${API_BASE_URL}/objects/search?cid=${query}&scope=${scope}`,
      {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
          'X-Auth-Provider': session.provider,
        },
      },
    );

    return response.json();
  },
  getRootObjects: async (
    scope: 'user' | 'global',
    offset: number,
    limit: number,
  ): Promise<PaginatedResult<ObjectSummary>> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${API_BASE_URL}/objects/roots?scope=${scope}&offset=${offset}&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
          'X-Auth-Provider': session.provider,
        },
      },
    );

    return response.json();
  },
  getSharedRoots: async (
    offset: number,
    limit: number,
  ): Promise<PaginatedResult<ObjectSummary>> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${API_BASE_URL}/objects/roots/shared?offset=${offset}&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
          'X-Auth-Provider': session.provider,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  getTrashObjects: async (
    offset: number,
    limit: number,
  ): Promise<PaginatedResult<ObjectSummary>> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${API_BASE_URL}/objects/roots/deleted?offset=${offset}&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
          'X-Auth-Provider': session.provider,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  generateApiKey: async (): Promise<ApiKey> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/apiKeys/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.provider,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  shareObject: async (dataCid: string, publicId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    await fetch(`${API_BASE_URL}/objects/${dataCid}/share`, {
      method: 'POST',
      body: JSON.stringify({ publicId }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.provider,
        'Content-Type': 'application/json',
      },
    });
  },
  markObjectAsDeleted: async (cid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    await fetch(`${API_BASE_URL}/objects/${cid}/delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.provider,
      },
    });
  },
  restoreObject: async (cid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/objects/${cid}/restore`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.provider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  onboardUser: async (): Promise<User> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/onboard`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.provider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  addAdmin: async (publicId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/admin/add`, {
      method: 'POST',
      body: JSON.stringify({ publicId }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.provider,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  removeAdmin: async (publicId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/admin/remove`, {
      method: 'POST',
      body: JSON.stringify({ publicId }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.provider,
        'Content-Type': 'application/json',
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
    downloadLimit: number,
  ): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.provider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/subscriptions/update`, {
      method: 'POST',
      body: JSON.stringify({
        granularity,
        uploadLimit,
        downloadLimit,
        publicId,
      }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.provider,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
};
