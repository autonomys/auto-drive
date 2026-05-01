import {
  ApiKey,
  ApiKeyWithoutSecret,
  CreateApiKeyInput,
  DeletionRequest,
  DeletionRequestWithUser,
  MaybeUser,
  OnboardedUser,
  PaginatedResult,
  User,
} from '@auto-drive/models';
import { getAuthSession } from 'utils/auth';
import { API_BASE_URL } from 'services/auth/config';

export const AuthService = {
  onboardUser: async (): Promise<User> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/onboard`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  addAdmin: async (publicId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/admin/add`, {
      method: 'POST',
      body: JSON.stringify({ publicId }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  removeAdmin: async (publicId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/admin/remove`, {
      method: 'POST',
      body: JSON.stringify({ publicId }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  generateApiKey: async (input: CreateApiKeyInput): Promise<ApiKey> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/apiKeys/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name,
        expiresAt: input.expiresAt ?? null,
      }),
    });

    if (!response.ok) {
      const message = await response
        .json()
        .then((b) => b?.error)
        .catch(() => null);
      throw new Error(message || `Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  deleteApiKey: async (apiKeyId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${API_BASE_URL}/users/@me/apiKeys/${apiKeyId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  getMe: async (): Promise<MaybeUser> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  getApiKeys: async (): Promise<ApiKeyWithoutSecret[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/apiKeys`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<ApiKeyWithoutSecret[]>;
  },
  getUserList: async (
    page: number,
    limit: number,
  ): Promise<PaginatedResult<OnboardedUser>> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${API_BASE_URL}/users/list?page=${page}&limit=${limit}&api`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  getUserByPublicId: async (publicId: string): Promise<OnboardedUser> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/${publicId}`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },

  // --- Account Deletion ---

  requestDeletion: async (
    reason?: string,
  ): Promise<DeletionRequest> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/deletion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify({ reason }),
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },

  cancelDeletion: async (): Promise<DeletionRequest> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/deletion`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },

  getDeletionStatus: async (): Promise<DeletionRequest | null> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${API_BASE_URL}/users/@me/deletion`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },

  // --- Admin Deletion ---

  getAdminDeletionRequests: async (
    status?: string,
  ): Promise<DeletionRequestWithUser[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const params = status ? `?status=${status}` : '';
    const response = await fetch(
      `${API_BASE_URL}/users/admin/deletions${params}`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },

  updateDeletionAdminNotes: async (
    requestId: string,
    notes: string,
  ): Promise<DeletionRequest> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${API_BASE_URL}/users/admin/deletions/${requestId}/notes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
        body: JSON.stringify({ notes }),
      },
    );

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
};
