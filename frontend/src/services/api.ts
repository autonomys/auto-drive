import { AuthProvider, createAutoDriveApi } from '@autonomys/auto-drive';
import {
  SubscriptionInfo,
  SubscriptionGranularity,
  ObjectInformation,
  DownloadStatus,
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
  getSubscription: async (): Promise<SubscriptionInfo> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/subscriptions/@me`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<SubscriptionInfo>;
  },
  getUserList: async (
    userPublicIds: string[],
  ): Promise<Record<string, SubscriptionInfo>> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/subscriptions/list`, {
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

    return response.json() as Promise<Record<string, SubscriptionInfo>>;
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
  updateSubscription: async (
    publicId: string,
    granularity: SubscriptionGranularity,
    uploadLimit: number,
    downloadLimit: number,
  ): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/subscriptions/update`, {
      method: 'POST',
      body: JSON.stringify({
        granularity,
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
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/objects/${headCid}/report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
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
    password?: string,
  ): Promise<AsyncIterable<Buffer>> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const api = createAutoDriveApi({
      downloadServiceUrl: downloadApiUrl,
      apiUrl: apiBaseUrl,
      provider: session.authProvider as AuthProvider,
      apiKey: session.accessToken,
    });

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
});
