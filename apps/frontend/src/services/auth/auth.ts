import {
  ApiKey,
  ApiKeyWithoutSecret,
  MaybeUser,
  OnboardedUser,
  PaginatedResult,
  User,
} from '@auto-drive/models';
import { getAuthSession } from 'utils/auth';
import { getApiBaseUrl } from 'services/auth/config';

export const AuthService = {
  onboardUser: async (): Promise<User> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${getApiBaseUrl()}/users/@me/onboard`, {
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

    const response = await fetch(`${getApiBaseUrl()}/users/admin/add`, {
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

    const response = await fetch(`${getApiBaseUrl()}/users/admin/remove`, {
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
  generateApiKey: async (): Promise<ApiKey> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${getApiBaseUrl()}/users/@me/apiKeys/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  deleteApiKey: async (apiKeyId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${getApiBaseUrl()}/users/@me/apiKeys/${apiKeyId}`,
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

    const response = await fetch(`${getApiBaseUrl()}/users/@me`, {
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

    const response = await fetch(`${getApiBaseUrl()}/users/@me/apiKeys`, {
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
      `${getApiBaseUrl()}/users/list?page=${page}&limit=${limit}&api`,
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

    const response = await fetch(`${getApiBaseUrl()}/users/${publicId}`, {
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
};
