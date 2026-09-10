import { AuthProvider, createAutoDriveApi } from '@autonomys/auto-drive';
import {
  AccountInfo,
  AccountModel,
  Banner,
  BannerCriticality,
  BannerInteractionType,
  BannerWithStats,
  DeletionAuditEntry,
  ObjectInformation,
  DownloadStatus,
  Intent,
  PaymentMethod,
  TouChangeType,
  TouStatus,
  TouVersion,
  TouVersionWithStats,
  UsdcAvailability,
  UsdcPaymentsStatus,
  UsdcPaymentTarget,
} from '@auto-drive/models';

// Wire-format of GET /credits/summary (bigint fields serialised as strings)
export type CreditSummaryResponse = {
  uploadBytesRemaining: string;
  /** Sum of upload_bytes_original across all active (non-expired) rows. */
  totalPurchasedBytesOriginal: string;
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

// Wire-format of rows from GET /credits/batches/all (admin endpoint).
// Extends ExpiringCreditBatch with the owner's userPublicId and refund state.
export type AdminCreditBatch = ExpiringCreditBatch & {
  userPublicId: string;
  /** ISO timestamp of the refund action, or null if not yet refunded. */
  refundedAt: string | null;
  /** On-chain tx hash of the AI3 refund transfer, or null if not refunded. */
  refundTxHash: string | null;
  /** EVM purchasing wallet that paid for the batch, if known. */
  fromAddress: string | null;
};

// Wire-format of GET /credits/economics (admin)
export type CreditEconomicsResponse = {
  totalExpiringWithin30Days: number;
  totalExpiringUploadBytes: string;
  totalExpiringDownloadBytes: string;
};

// Wire-format of rows from GET /intents/over-cap (admin)
export type OverCapIntent = {
  id: string;
  userPublicId: string;
  status: string;
  txHash?: string;
  paymentAmount?: string;
  shannonsPerByte: string;
  expiresAt?: string;
};

// Wire-format of rows from GET /credits/batches/user/:userPublicId (admin).
// Extends ExpiringCreditBatch with intent fields so the admin can see the
// AI3 price paid and the EVM wallet address used for the on-chain payment.
export type AdminUserCreditBatch = ExpiringCreditBatch & {
  userPublicId: string;
  paymentAmount: string | null;
  shannonsPerByte: string;
  txHash: string | null;
  fromAddress: string | null;
  /** ISO timestamp of the refund action, or null if not yet refunded. */
  refundedAt: string | null;
  /** On-chain tx hash of the AI3 refund transfer, or null if not refunded. */
  refundTxHash: string | null;
};
import { getAuthSession } from 'utils/auth';
import { uploadFileContent } from 'utils/file';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * The backend's machine-readable error code, when the body carried one.
     *
     * Present only for the errors that send `{ error: CODE, message }` —
     * CREDIT_CAP_EXCEEDED, USDC_PAYMENTS_UNAVAILABLE, PRICE_ORACLE_UNAVAILABLE
     * and friends. Undefined for the plain `{ error: <message> }` shape, whose
     * `error` is prose and must never be mistaken for a code.
     *
     * Exists so a caller can BRANCH rather than match on prose: the purchase
     * flow falls back to AI3 on a closed USDC path, and the wording of that
     * sentence is not something a fallback should depend on.
     */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface UploadResponse {
  cid: string;
}

/**
 * An intent as it comes back from `POST /intents`, with its bigints parsed.
 *
 * Only the fields the purchase flow uses. `quotedTokenAmount` is the whole
 * reason this is an object rather than the id it used to be: a USDC purchase is
 * a specific number of USDC base units that the backend computed and locked, and
 * the client has no way to recompute it — the oracle rate and the margin both
 * live server-side.
 */
export type CreatedIntent = {
  id: string;
  /**
   * Present from the USDC path onward; absent on rows created before the column
   * existed. Read it as AI3_NATIVE when missing, exactly as the backend does.
   */
  paymentMethod?: PaymentMethod;
  /** The price lock. Null on intents created before expiry existed. */
  expiresAt: Date | null;
  /**
   * USDC base units the buyer must transfer — the exact amount, margin included
   * and rounded up. Null on the AI3 path, which locks a per-byte rate instead
   * and settles against whatever arrives.
   */
  quotedTokenAmount: bigint | null;
};

/** Options for `createIntent`. */
export type CreateIntentOptions = {
  requestedBytes?: bigint;
  /**
   * Omitted means AI3, which is what the backend defaults to — so an
   * option-less call behaves exactly as it always has.
   */
  paymentMethod?: PaymentMethod;
};

/**
 * The error a failed API response should become.
 *
 * One reader for two body shapes, because the backend has two. Errors carrying
 * a machine-readable code send `{ error: CODE, message }`, and that `message` is
 * written to be read by whoever is buying. The HttpError default sends
 * `{ error: <the message> }` with no `message` key at all.
 *
 * So `message` is taken at any status, and `error` only below 500. On a 5xx the
 * plain shape is not a sentence about the request — it is a raw exception,
 * because handleInternalErrorResult builds the body as
 * `Failed to ...: ${e.message}`. Passing that through puts
 * `connect ECONNREFUSED 10.0.3.7:9944` under the Send button whenever the
 * consensus WebSocket is down.
 *
 * Gating on the status alone would fail in the other direction: a 503 carrying
 * USDC_PAYMENTS_UNAVAILABLE or PRICE_ORACLE_UNAVAILABLE has a message that is
 * exactly what the user needs. Keying on which field is PRESENT rather than on
 * the status is what makes both arrive correctly.
 *
 * Shared rather than inlined per call site, so a caller that branches on `code`
 * — the purchase flow falls back to AI3 on a closed USDC path — gets the same
 * answer from every endpoint instead of only the ones that remembered to parse.
 */
const toApiError = async (
  response: Response,
  fallback: string,
): Promise<ApiError> => {
  const parsed = await response
    .json()
    .then((body: { message?: string; error?: string }) => ({
      detail:
        response.status < 500 ? (body?.message ?? body?.error) : body?.message,
      // Only the coded shape has both keys, and only there is `error` a code
      // rather than prose. Without this guard the plain shape's sentence would
      // arrive as a `code`, and a caller branching on it would match nothing
      // while looking like it might.
      code:
        body?.message !== undefined && body?.error !== undefined
          ? body.error
          : undefined,
    }))
    .catch(() => ({ detail: undefined, code: undefined }));

  return new ApiError(response.status, parsed.detail ?? fallback, parsed.code);
};

export type Api = ReturnType<typeof createApiService>;

export const createApiService = ({
  apiBaseUrl,
  downloadApiUrl,
}: {
  apiBaseUrl: string;
  downloadApiUrl: string;
}) => ({
  createIntent: async ({
    requestedBytes,
    paymentMethod,
  }: CreateIntentOptions = {}): Promise<CreatedIntent> => {
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
      // As a decimal string: JSON.stringify cannot serialize a BigInt, and the
      // backend takes the string form as canonical anyway.
      body: JSON.stringify({
        expiresAt,
        ...(requestedBytes !== undefined && {
          requestedBytes: requestedBytes.toString(),
        }),
        // Omitted rather than defaulted to AI3, so a body from this client is
        // byte-for-byte what it has always been on the AI3 path.
        ...(paymentMethod !== undefined && { paymentMethod }),
      }),
    });

    if (!response.ok) {
      // The cap rejection is the one failure here a user can act on, and it
      // names the cap and their balance. Surfacing statusText instead would turn
      // "you have 2 GiB of room left" into "Forbidden". See toApiError for how
      // the two body shapes are told apart.
      throw await toApiError(
        response,
        `Network response was not ok: ${response.statusText}`,
      );
    }

    const intent = (await response.json()) as {
      id: string;
      paymentMethod?: PaymentMethod;
      expiresAt?: string;
      quotedTokenAmount?: string;
    };
    return {
      id: intent.id,
      paymentMethod: intent.paymentMethod,
      // Parsed leniently on purpose. Every field but `id` is absent on some
      // legitimate response — an AI3 intent has no quote, a pre-expiry row has
      // no lock — and a strict parse would turn "this intent has no quote"
      // into a thrown error on the path that was working before USDC existed.
      expiresAt: intent.expiresAt ? new Date(intent.expiresAt) : null,
      quotedTokenAmount:
        intent.quotedTokenAmount !== undefined
          ? BigInt(intent.quotedTokenAmount)
          : null,
    };
  },
  /**
   * Where a USDC payment must be sent, as this deployment reports it.
   *
   * Fetched rather than compiled in: the chain and the receiver are the
   * backend's environment, and a client that guessed would approve USDC to a
   * contract on a chain nobody watches. See UsdcPaymentTarget.
   *
   * 403 (USDC_PAYMENTS_DISABLED) when the deployment has no Ethereum
   * configuration at all, which is a normal state rather than a fault.
   */
  getUsdcPaymentTarget: async (): Promise<UsdcPaymentTarget> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/payments/usdc/target`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      // Through toApiError like every other call, so the 403's
      // USDC_PAYMENTS_DISABLED code survives to whoever is deciding whether to
      // offer the option at all.
      throw await toApiError(
        response,
        `Failed to read the USDC payment target: ${response.statusText}`,
      );
    }

    return response.json() as Promise<UsdcPaymentTarget>;
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
      // ApiError rather than Error so the status survives. 410 is the one
      // answer here a caller can act on: the backend refuses to record a hash
      // against a lapsed lock (isIntentExpired). That is a CAUTION, not a
      // verdict — the payment is usually still credited — so the USDC panel
      // raises it at once rather than after six confirmations, and withdraws it
      // on the first successful read of the intent.
      throw await toApiError(
        response,
        `Network response was not ok: ${response.statusText}`,
      );
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
      // Through toApiError like the rest: 410 is what the polling loop reads,
      // and a code the backend may add later then survives without a second
      // change here.
      throw await toApiError(
        response,
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
  unbanFile: async (headCid: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/objects/${headCid}/unban`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to unban file: ${response.statusText}`);
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
      signal?: AbortSignal;
    },
  ): Promise<AsyncIterable<Buffer>> => {
    const {
      password,
      skipDecryption,
      authMode = 'auto',
      signal,
    } = options ?? {};
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

    const { asyncFromStream } = await import('@autonomys/asynchronous');

    // Fetch upload-options metadata so we know whether to decrypt/decompress.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let metadata: any = null;
    if (!skipDecryption) {
      const metadataRes = await api.sendAPIRequest(`/objects/${cid}/metadata`, {
        method: 'GET',
        signal,
      });
      if (!metadataRes.ok) {
        throw new Error('Failed to retrieve file metadata');
      }
      metadata = await metadataRes.json();
    }

    const response = await api.sendDownloadRequest(
      `/downloads/${cid}?ignoreEncoding=true`,
      { method: 'GET', signal },
    );
    if (!response.ok) {
      let errorMsg: string;
      if (response.status === 401) {
        errorMsg = 'Authentication required to download this file';
      } else if (response.status === 402) {
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

    let iterable: AsyncIterable<Buffer> = asyncFromStream(response.body);

    if (!skipDecryption && metadata?.uploadOptions?.encryption) {
      if (!password) {
        throw new Error('Password is required to decrypt the file');
      }
      const { decryptFile } = await import('@autonomys/auto-dag-data');
      iterable = decryptFile(iterable, password, {
        algorithm: metadata.uploadOptions.encryption.algorithm,
      });
    }

    if (!skipDecryption && metadata?.uploadOptions?.compression) {
      const { decompressFile } = await import('@autonomys/auto-dag-data');
      iterable = decompressFile(iterable, {
        algorithm: metadata.uploadOptions.compression.algorithm,
      });
    }

    return iterable;
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

    const response = await fetch(`${apiBaseUrl}/banners/${bannerId}/interact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
      body: JSON.stringify({ type }),
    });

    if (!response.ok) {
      throw new Error(`Failed to interact with banner: ${response.statusText}`);
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

    const response = await fetch(`${downloadApiUrl}/downloads/async/${cid}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create async download: ${response.statusText}`,
      );
    }
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
  getCreditBatches: async (): Promise<ExpiringCreditBatch[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/credits/batches`, {
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
    // GET /intents/price is a public endpoint (registered before the auth /
    // feature-flag middleware). Attach auth headers when a session exists, but
    // don't require one — this lets the purchase screen show live pricing to
    // logged-out and non-Google visitors too.
    const session = await getAuthSession();
    const headers: Record<string, string> = {};
    if (session?.authProvider && session.accessToken) {
      headers['X-Auth-Provider'] = session.authProvider;
      headers['Authorization'] = `Bearer ${session.accessToken}`;
    }

    const response = await fetch(`${apiBaseUrl}/intents/price`, { headers });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json();
  },

  // -------------------------------------------------------------------------
  // Admin: all credit batches across all users
  // -------------------------------------------------------------------------

  getAdminCreditBatches: async (): Promise<AdminCreditBatch[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/credits/batches/all`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<AdminCreditBatch[]>;
  },

  // -------------------------------------------------------------------------
  // Admin: system-wide credit economics summary
  // -------------------------------------------------------------------------

  getCreditEconomics: async (): Promise<CreditEconomicsResponse> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/credits/economics`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<CreditEconomicsResponse>;
  },

  // -------------------------------------------------------------------------
  // Admin: list OVER_CAP intents
  // -------------------------------------------------------------------------

  getOverCapIntents: async (): Promise<OverCapIntent[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/intents/over-cap`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return response.json() as Promise<OverCapIntent[]>;
  },

  // -------------------------------------------------------------------------
  // Admin: reprocess a single OVER_CAP intent
  // -------------------------------------------------------------------------

  reprocessIntent: async (intentId: string): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${apiBaseUrl}/intents/${intentId}/reprocess`,
      {
        method: 'POST',
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
      throw new Error(`Failed to fetch ToU status: ${response.statusText}`);
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
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error || `Failed to promote ToU version: ${response.statusText}`,
      );
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
      throw new Error(`Failed to activate ToU version: ${response.statusText}`);
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
      throw new Error(`Failed to archive ToU version: ${response.statusText}`);
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

  // --- Deletion Admin (backend) ---

  getDeletionAuditLog: async (
    publicId: string,
  ): Promise<DeletionAuditEntry[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${apiBaseUrl}/deletion/admin/audit/${publicId}`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to get deletion audit log: ${response.statusText}`,
      );
    }

    return response.json() as Promise<DeletionAuditEntry[]>;
  },

  getDeletionStats: async (): Promise<{
    totalAnonymisations: number;
    recentAnonymisations: number;
  }> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/deletion/admin/stats`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get deletion stats: ${response.statusText}`);
    }

    return response.json();
  },

  // -------------------------------------------------------------------------
  // Admin: get all credit batches for a specific user with intent data
  // GET /credits/batches/user/:userPublicId
  // -------------------------------------------------------------------------

  getUserCreditBatches: async (
    userPublicId: string,
  ): Promise<AdminUserCreditBatch[]> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${apiBaseUrl}/credits/batches/user/${encodeURIComponent(userPublicId)}`,
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

    return response.json() as Promise<AdminUserCreditBatch[]>;
  },

  // -------------------------------------------------------------------------
  // Admin: mark a credit batch as refunded
  // POST /credits/batches/:id/refund
  // The on-chain refund transaction hash is mandatory — the backend rejects
  // requests without it and the batch is NOT marked as refunded.
  // -------------------------------------------------------------------------

  refundCreditBatch: async (
    batchId: string,
    refundTxHash: string,
  ): Promise<void> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${apiBaseUrl}/credits/batches/${encodeURIComponent(batchId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refundTxHash }),
      },
    );

    if (!response.ok) {
      const message = await response
        .json()
        .then((body) => body?.error as string | undefined)
        .catch(() => undefined);
      throw new Error(
        message ?? `Network response was not ok: ${response.statusText}`,
      );
    }
  },

  // -------------------------------------------------------------------------
  // Admin: mark several credit batches as refunded in one atomic operation
  // POST /credits/batches/refund
  // The same on-chain refund transaction hash is recorded on every batch
  // (one AI3 transfer can cover multiple batches of the same account).
  // -------------------------------------------------------------------------

  refundCreditBatches: async (
    batchIds: string[],
    refundTxHash: string,
  ): Promise<{ refundedCount: number; alreadyRefundedCount: number }> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/credits/batches/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batchIds, refundTxHash }),
    });

    if (!response.ok) {
      const message = await response
        .json()
        .then((body) => body?.error as string | undefined)
        .catch(() => undefined);
      throw new Error(
        message ?? `Network response was not ok: ${response.statusText}`,
      );
    }

    return response.json() as Promise<{
      refundedCount: number;
      alreadyRefundedCount: number;
    }>;
  },

  // ── USDC payment gates (admin) ─────────────────────────────────────────
  // Every gate on the USDC path plus the oracle's health. Not cached on the
  // server: a kill switch whose state waits out a TTL is not the control an
  // incident needs.
  getUsdcPaymentsStatus: async (): Promise<UsdcPaymentsStatus> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(`${apiBaseUrl}/payments/usdc/status`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to get USDC payment status: ${response.statusText}`,
      );
    }

    return response.json() as Promise<UsdcPaymentsStatus>;
  },

  // Flip the manual gate. `changed` is false when the gate already held this
  // value, which is also when no Slack alert was posted. `availability` is the
  // composite AFTER the flip — enabling the switch does not open the path if the
  // treasury is over its cap.
  //
  // Optional: the flip is the result, the re-read is a convenience, and the
  // server omits the composite rather than failing a flip that already happened.
  setUsdcPayments: async (
    enabled: boolean,
  ): Promise<{
    enabled: boolean;
    changed: boolean;
    availability?: UsdcAvailability;
  }> => {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) {
      throw new Error('No session');
    }

    const response = await fetch(
      `${apiBaseUrl}/payments/usdc/${enabled ? 'enable' : 'disable'}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Auth-Provider': session.authProvider,
        },
      },
    );

    if (!response.ok) {
      const message = await response
        .json()
        .then((body) => body?.error as string | undefined)
        .catch(() => undefined);
      throw new Error(
        message ??
          `Failed to ${enabled ? 'enable' : 'disable'} USDC payments: ${
            response.statusText
          }`,
      );
    }

    return response.json() as Promise<{
      enabled: boolean;
      changed: boolean;
      availability?: UsdcAvailability;
    }>;
  },
});
