import { AuthProvider, createAutoDriveApi } from '@autonomys/auto-drive';
import {
  AccountInfo,
  AccountModel,
  Banner,
  BannerCriticality,
  BannerInteractionType,
  BannerWithStats,
  ObjectInformation,
  DownloadStatus,
  Intent,
  TouChangeType,
  TouStatus,
  TouVersion,
  TouVersionWithStats,
} from '@auto-drive/models';

// Wire-format of GET /credits/summary (bigint fields serialised as strings)
export type CreditSummaryResponse = {
  uploadBytesRemaining: string;
  downloadBytesRemaining: string;
  nextExpiryDate: string | null;
  batchCount: number;
  canPurchase: boolean;
  maxPurchasableBytes: string;
  googleVerified: boolean;
  /** Number of days after purchase before credits expire (from CREDIT_EXPIRY_DAYS env var). */
  expiryDays: number;
};

// Wire-format of individual rows from GET /credits/batches/expiring
export type ExpiringCreditBatch = {
  id: string;
  accountId: string;
  intentId: string;
  uploadBytesOriginal: string;
  uploadBytesRemaining: string;
  downloadBytesOriginal: string;
  downloadBytesRemaining: string;
  purchasedAt: string;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
  updatedAt: string;
};
import { getAuthSession } from 'utils/auth';
import { uploadFileContent } from 'utils/file';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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
      throw new ApiError(
        response.status,
        `Network response was not ok: ${response.statusText}`,
      );
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

    if (
      authMode === 'session' &&
      (!session?.accessToken || !session?.authProvider)
    ) {
      throw new Error(
        'Downloading large files require authorization, please login via gauth, wallet, github or discord',
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
              ? 'Downloading large files require authorization, please login via gauth, wallet, github or discord'
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
  // Banners
  getActiveBanners: async (): Promise<Banner[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      return [];
    }

    const response = await fetch(`${apiBaseUrl}/banners/active`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      return [];
    }

    return response.json() as Promise<Banner[]>;
  },
  interactWithBanner: async (
    bannerId: string,
    type: BannerInteractionType,
  ): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${apiBaseUrl}/banners/${bannerId}/interact`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
        body: JSON.stringify({ type }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to interact with banner: ${response.statusText}`,
      );
    }
  },
  // Admin banner methods
  getAllBanners: async (): Promise<Banner[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/banners/admin`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get banners: ${response.statusText}`);
    }

    return response.json() as Promise<Banner[]>;
  },
  createBanner: async (params: {
    title: string;
    body: string;
    criticality: BannerCriticality;
    dismissable: boolean;
    requiresAcknowledgement: boolean;
    displayStart: string;
    displayEnd: string | null;
    active: boolean;
  }): Promise<Banner> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/banners/admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Failed to create banner: ${response.statusText}`);
    }

    return response.json() as Promise<Banner>;
  },
  updateBanner: async (
    bannerId: string,
    params: {
      title?: string;
      body?: string;
      criticality?: BannerCriticality;
      dismissable?: boolean;
      requiresAcknowledgement?: boolean;
      displayStart?: string;
      displayEnd?: string | null;
      active?: boolean;
    },
  ): Promise<Banner> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/banners/admin/${bannerId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Failed to update banner: ${response.statusText}`);
    }

    return response.json() as Promise<Banner>;
  },
  toggleBanner: async (bannerId: string, active: boolean): Promise<Banner> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${apiBaseUrl}/banners/admin/${bannerId}/toggle`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
        body: JSON.stringify({ active }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to toggle banner: ${response.statusText}`);
    }

    return response.json() as Promise<Banner>;
  },
  getBannerStats: async (bannerId: string): Promise<BannerWithStats> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${apiBaseUrl}/banners/admin/${bannerId}/stats`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to get banner stats: ${response.statusText}`);
    }

    return response.json() as Promise<BannerWithStats>;
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
  getCreditSummary: async (): Promise<CreditSummaryResponse> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/credits/summary`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<CreditSummaryResponse>;
  },
  getExpiringCreditBatches: async (): Promise<ExpiringCreditBatch[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/credits/batches/expiring`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<ExpiringCreditBatch[]>;
  },
  getCreditPrice: async (): Promise<{ price: number; pricePerGB: number }> => {
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
  // Terms of Use
  getTouStatus: async (): Promise<TouStatus> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      return { accepted: true, currentVersion: null, pendingVersion: null };
    }

    const response = await fetch(`${apiBaseUrl}/tou/status`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      return { accepted: true, currentVersion: null, pendingVersion: null };
    }

    return response.json() as Promise<TouStatus>;
  },
  acceptTou: async (): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/tou/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to accept ToU: ${response.statusText}`);
    }
  },
  // Admin ToU methods
  getAllTouVersions: async (): Promise<TouVersion[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/tou/admin`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get ToU versions: ${response.statusText}`);
    }

    return response.json() as Promise<TouVersion[]>;
  },
  createTouVersion: async (params: {
    versionLabel: string;
    effectiveDate: string;
    contentUrl: string;
    changeType: TouChangeType;
    adminNotes?: string;
  }): Promise<TouVersion> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/tou/admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Failed to create ToU version: ${response.statusText}`);
    }

    return response.json() as Promise<TouVersion>;
  },
  updateTouVersion: async (
    id: string,
    params: {
      versionLabel?: string;
      effectiveDate?: string;
      contentUrl?: string;
      changeType?: TouChangeType;
      adminNotes?: string | null;
    },
  ): Promise<TouVersion> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/tou/admin/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Failed to update ToU version: ${response.statusText}`);
    }

    return response.json() as Promise<TouVersion>;
  },
  promoteTouVersion: async (
    id: string,
    overrideNotice?: boolean,
    overrideReason?: string,
  ): Promise<TouVersion> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/tou/admin/${id}/promote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify({ overrideNotice, overrideReason }),
    });

    if (!response.ok) {
      throw new Error(`Failed to promote ToU version: ${response.statusText}`);
    }

    return response.json() as Promise<TouVersion>;
  },
  activateTouVersion: async (id: string): Promise<TouVersion> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/tou/admin/${id}/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to activate ToU version: ${response.statusText}`,
      );
    }

    return response.json() as Promise<TouVersion>;
  },
  archiveTouVersion: async (id: string): Promise<TouVersion> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/tou/admin/${id}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to archive ToU version: ${response.statusText}`,
      );
    }

    return response.json() as Promise<TouVersion>;
  },
  getTouVersionStats: async (id: string): Promise<TouVersionWithStats> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/tou/admin/${id}/stats`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to get ToU version stats: ${response.statusText}`,
      );
    }

    return response.json() as Promise<TouVersionWithStats>;
  },
});
