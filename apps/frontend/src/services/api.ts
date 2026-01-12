import { AuthProvider, createAutoDriveApi } from '@autonomys/auto-drive';
import {
  AccountInfo,
  AccountModel,
  ObjectInformation,
  DownloadStatus,
  Intent,
} from '@auto-drive/models';
import { getAuthSession } from 'utils/auth';
import { uploadFileContent } from 'utils/file';

export interface UploadResponse {
  cid: string;
}

export type Api = ReturnType<typeof createApiService>;

export const createApiService = ({
  apiBaseUrl,
  downloadApiUrl,
}: {
  apiBaseUrl: string;
  downloadApiUrl: string;
}) => ({
  createIntent: async (): Promise<string> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    // expiresAt must be at least 1 hour from now per backend schema
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 2); // 2 hours buffer

    const response = await fetch(`${apiBaseUrl}/intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify({ expiresAt }),
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    const intent = (await response.json()) as { id: string };
    return intent.id;
  },
  watchIntent: async (intentId: string, txHash: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/intents/${intentId}/watch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify({ txHash }),
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  getIntent: async (intentId: string): Promise<Intent> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/intents/${intentId}`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<Intent>;
  },
  getAccount: async (): Promise<AccountInfo> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/accounts/@me`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<AccountInfo>;
  },
  getFeatures: async (): Promise<Record<string, boolean>> => {
    const session = await getAuthSession().catch(() => null);

    const response = await fetch(`${apiBaseUrl}/features`, {
      headers: {
        ...(session?.accessToken
          ? {
              Authorization: `Bearer ${session?.accessToken}`,
              'X-Auth-Provider': session.authProvider,
            }
          : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get features: ${response.statusText}`);
    }

    return response.json();
  },
  getUserList: async (
    userPublicIds: string[],
  ): Promise<Record<string, AccountInfo>> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/accounts/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify({ userPublicIds }),
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<Record<string, AccountInfo>>;
  },
  uploadFile: async (file: File): Promise<UploadResponse> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/objects/file`, {
      method: 'POST',
      body: JSON.stringify({
        data: await uploadFileContent(file),
        filename: file.name,
        mimeType: file.type,
      }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  fetchUploadedObjectMetadata: async (
    cid: string,
  ): Promise<ObjectInformation> => {
    const response = await fetch(`${apiBaseUrl}/objects/${cid}`);

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
  shareObject: async (dataCid: string, publicId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    await fetch(`${apiBaseUrl}/objects/${dataCid}/share`, {
      method: 'POST',
      body: JSON.stringify({ publicId }),
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
        'Content-Type': 'application/json',
      },
    });
  },
  markObjectAsDeleted: async (cid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    await fetch(`${apiBaseUrl}/objects/${cid}/delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });
  },
  restoreObject: async (cid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/objects/${cid}/restore`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
  },
  updateAccount: async (
    publicId: string,
    model: AccountModel,
    uploadLimit: number,
    downloadLimit: number,
  ): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/accounts/update`, {
      method: 'POST',
      body: JSON.stringify({
        model,
        uploadLimit,
        downloadLimit,
        publicId,
      }),
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
  publishObject: async (cid: string): Promise<string> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const apiDrive = createAutoDriveApi({
      provider: session.authProvider as AuthProvider,
      apiKey: session.accessToken,
      apiUrl: apiBaseUrl,
    });

    return apiDrive.publishObject(cid);
  },

  reportFile: async (headCid: string): Promise<void> => {
    const response = await fetch(`${apiBaseUrl}/objects/${headCid}/report`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Failed to report file: ${response.statusText}`);
    }
  },
  banFile: async (headCid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/objects/${headCid}/ban`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to ban file: ${response.statusText}`);
    }
  },
  dismissReport: async (headCid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${apiBaseUrl}/objects/${headCid}/dismiss-report`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to dismiss report: ${response.statusText}`);
    }
  },
  // Download
  downloadObject: async (
    cid: string,
    options?: {
      password?: string;
      skipDecryption?: boolean;
      authMode?: 'auto' | 'anonymous' | 'session';
    },
  ): Promise<AsyncIterable<Buffer>> => {
    const { password, skipDecryption, authMode = 'auto' } = options ?? {};
    const session = await getAuthSession().catch(() => null);

    if (authMode === 'session' && (!session?.accessToken || !session?.authProvider)) {
      throw new Error(
        'Downloading large files requires authorization, please login via gauth, wallet, github or discord',
      );
    }

    const apiKey =
      authMode === 'anonymous' ? null : (session?.accessToken ?? null);
    const provider =
      authMode === 'anonymous'
        ? undefined
        : ((session?.authProvider as AuthProvider | undefined) ?? undefined);

    const api = createAutoDriveApi({
      downloadServiceUrl: downloadApiUrl,
      apiUrl: apiBaseUrl,
      apiKey,
      provider,
    });

    if (skipDecryption) {
      const { asyncFromStream } = await import('@autonomys/asynchronous');
      const response = await api.sendDownloadRequest(
        `/downloads/${cid}?ignoreEncoding=true`,
        { method: 'GET' },
      );
      if (!response.ok) {
        let errorMsg: string;
        if (response.status === 401) {
          errorMsg = 'Authentication required to download this file';
        } else if (response.status === 402) {
          // Backend uses 402 for both "file too large to download anonymously"
          // and "not enough download credits". Use authMode to pick messaging.
          errorMsg =
            authMode === 'anonymous'
              ? 'Downloading large files requires authorization, please login via gauth, wallet, github or discord'
              : 'Download limit exceeded';
        } else if (response.status === 403) {
          errorMsg = 'You do not have permission to download this file';
        } else if (response.status === 404) {
          errorMsg = 'File not found';
        } else if (response.status >= 500) {
          errorMsg = 'Server error occurred while downloading the file';
        } else {
          errorMsg = `Failed to download file: ${response.statusText}`;
        }
        throw new Error(errorMsg);
      }
      if (!response.body) {
        throw new Error('No body returned from download request');
      }
      return asyncFromStream(response.body);
    }

    return api.downloadFile(cid, password);
  },
  createAsyncDownload: async (cid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    await fetch(`${downloadApiUrl}/downloads/async/${cid}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });
  },
  dismissAsyncDownload: async (id: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    await fetch(`${downloadApiUrl}/downloads/async/${id}/dismiss`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });
  },
  checkDownloadStatus: async (cid: string): Promise<DownloadStatus> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${downloadApiUrl}/downloads/${cid}/status`, {
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return (response.json() as Promise<{ status: DownloadStatus }>).then(
      (data) => data.status,
    );
  },
  getCreditPrice: async (): Promise<{ price: number }> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/intents/price`, {
      headers: {
        'X-Auth-Provider': session.authProvider,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },
});
