/**
 * Unit tests for `createApiService().createIntent` error surfacing.
 *
 * The message thrown here is shown verbatim to the user: Step 3 catches it and
 * renders `error.message` under the Send button, because a failure before the
 * wallet call has no other channel. So which half of the response body reaches
 * the throw is a product decision, not a formatting one.
 *
 * Two body shapes exist. Errors carrying a machine-readable code send
 * `{ error: CODE, message }`; the HttpError default sends `{ error: <message> }`
 * with no `message` key. On a 5xx that second shape is a raw exception — the
 * backend builds it as `Failed to create intent: ${e.message}` — so passing it
 * through leaks internal plumbing to whoever is trying to buy storage.
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports so Jest hoists them
// ---------------------------------------------------------------------------

jest.mock('@autonomys/auto-drive', () => ({
  createAutoDriveApi: jest.fn(),
}));

jest.mock('utils/auth', () => ({
  getAuthSession: jest.fn(),
}));

jest.mock('utils/file', () => ({
  uploadFileContent: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ApiError, createApiService } from '../../../src/services/api';
import { getAuthSession } from 'utils/auth';
import { PaymentMethod } from '@auto-drive/models';

const mockGetAuthSession = getAuthSession as jest.MockedFunction<
  typeof getAuthSession
>;

const api = createApiService({
  apiBaseUrl: 'https://api.test',
  downloadApiUrl: 'https://download.test',
});

/** Stand in for one `fetch` response, with only what createIntent reads. */
const mockFetchResponse = (
  status: number,
  body: unknown,
  statusText = 'Some Status',
) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: async () => body,
  }) as unknown as typeof fetch;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthSession.mockResolvedValue({
    authProvider: 'google',
    accessToken: 'token',
  } as unknown as Awaited<ReturnType<typeof getAuthSession>>);
});

describe('createIntent error surfacing', () => {
  it('surfaces the message of a coded 4xx — the cap rejection', async () => {
    // The one failure a user can act on: it names the cap and their balance.
    mockFetchResponse(
      403,
      {
        error: 'CREDIT_CAP_EXCEEDED',
        message:
          'Purchase of 3221225472 bytes would exceed the per-user credit cap of 107374182400 bytes: the account already holds 106300440576 bytes, leaving 1073741824 available',
      },
      'Forbidden',
    );

    await expect(api.createIntent({ requestedBytes: 3221225472n })).rejects.toThrow(
      /leaving 1073741824 available/,
    );
  });

  it('surfaces the message of a coded 5xx — the price oracle being down', async () => {
    // FORWARD-LOOKING. No 5xx this endpoint returns today carries a `message`;
    // the USDC quote path stacked on this branch adds this exact one. So this
    // locks a contract rather than guarding current behaviour — it passes both
    // before and after the fix in this diff, and fails under the plausible
    // wrong fix of gating the passthrough on `status < 500` alone, which is why
    // it is here.
    mockFetchResponse(
      503,
      {
        error: 'PRICE_ORACLE_UNAVAILABLE',
        message: 'The AI3/USD rate could not be established right now',
      },
      'Service Unavailable',
    );

    await expect(api.createIntent({ requestedBytes: 1n })).rejects.toThrow(
      /rate could not be established/,
    );
  });

  it('does NOT surface a raw exception from an uncoded 5xx', async () => {
    // handleInternalErrorResult builds this body. Passing it through puts
    // `connect ECONNREFUSED 10.0.3.7:9944` under the Send button whenever the
    // consensus WebSocket is down.
    mockFetchResponse(
      500,
      { error: 'Failed to create intent: connect ECONNREFUSED 10.0.3.7:9944' },
      'Internal Server Error',
    );

    await expect(api.createIntent({ requestedBytes: 1n })).rejects.toThrow(
      'Network response was not ok: Internal Server Error',
    );
    await expect(api.createIntent({ requestedBytes: 1n })).rejects.not.toThrow(/ECONNREFUSED/);
  });

  it('still surfaces an uncoded 4xx, which describes the request', async () => {
    // The plain shape on a 4xx is a sentence about what was sent, not about our
    // plumbing, so it stays useful.
    mockFetchResponse(
      400,
      { error: 'Invalid requestedBytes: 0 — must be a positive number of bytes' },
      'Bad Request',
    );

    await expect(api.createIntent({ requestedBytes: 0n })).rejects.toThrow(
      /must be a positive number of bytes/,
    );
  });

  it('falls back to statusText when the body is not JSON at all', async () => {
    // A proxy or load balancer returning HTML, which .json() rejects on.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    }) as unknown as typeof fetch;

    await expect(api.createIntent({ requestedBytes: 1n })).rejects.toThrow(
      'Network response was not ok: Bad Gateway',
    );
  });

  it('sends requestedBytes as a decimal string, and omits it when absent', async () => {
    // JSON.stringify cannot serialize a BigInt; the backend takes the string
    // form as canonical. Guarding it here because the failure would be a body
    // the server rejects rather than a type error.
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ id: '0xabc' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await api.createIntent({ requestedBytes: 1_073_741_824n });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({ requestedBytes: '1073741824' }),
    );

    await api.createIntent();
    expect(
      JSON.parse(fetchMock.mock.calls[1][1].body),
    ).not.toHaveProperty('requestedBytes');
  });
});

// ---------------------------------------------------------------------------
// The USDC additions: a code to branch on, and a quote to charge
// ---------------------------------------------------------------------------

describe('createIntent USDC support', () => {
  const mockOkResponse = (body: unknown) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it('sends paymentMethod when asked, and omits it otherwise', async () => {
    // Omitted rather than defaulted to AI3: the backend's own default applies,
    // so an AI3 request body stays byte-for-byte what it has always been.
    const fetchMock = mockOkResponse({ id: '0xabc' });

    await api.createIntent({
      requestedBytes: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({ paymentMethod: 'usdc_eth' }),
    );

    await api.createIntent({ requestedBytes: 1n });
    expect(
      JSON.parse(fetchMock.mock.calls[1][1].body),
    ).not.toHaveProperty('paymentMethod');
  });

  it('parses the locked quote as a bigint and the lock as a Date', async () => {
    // `quotedTokenAmount` is the exact amount the wallet will be asked to move,
    // and it crosses the wire as a decimal string because res.json() cannot
    // serialise a BigInt. Reading it as a Number would round at ~9e15 base
    // units, and rounding an amount charged is not a display bug.
    mockOkResponse({
      id: '0xintent',
      paymentMethod: 'usdc_eth',
      expiresAt: '2026-08-27T12:10:00.000Z',
      quotedTokenAmount: '12505001',
    });

    const intent = await api.createIntent({
      requestedBytes: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
    });

    expect(intent.id).toBe('0xintent');
    expect(intent.paymentMethod).toBe(PaymentMethod.USDC_ETH);
    expect(intent.quotedTokenAmount).toBe(12505001n);
    expect(intent.expiresAt).toEqual(new Date('2026-08-27T12:10:00.000Z'));
  });

  it('leaves the AI3 shape intact, with nulls rather than a throw', async () => {
    // An AI3 intent has no quote and — on a row created before the price lock
    // existed — no expiry either. A strict parse would turn "this intent has no
    // quote" into an exception on the path that worked before USDC existed.
    mockOkResponse({ id: '0xai3' });

    const intent = await api.createIntent({ requestedBytes: 1n });

    expect(intent).toEqual({
      id: '0xai3',
      paymentMethod: undefined,
      expiresAt: null,
      quotedTokenAmount: null,
    });
  });

  it('carries USDC_PAYMENTS_UNAVAILABLE as a code, not just prose', async () => {
    // This is what lets the purchase flow fall back to AI3 without matching on
    // the sentence it renders. The message is surfaced too, because it is
    // written for whoever is buying.
    mockFetchResponse(
      503,
      {
        error: 'USDC_PAYMENTS_UNAVAILABLE',
        message:
          'Paying in USDC is temporarily unavailable. Pay in AI3 instead, or try again later.',
      },
      'Service Unavailable',
    );

    const error = await api
      .createIntent({ requestedBytes: 1n, paymentMethod: PaymentMethod.USDC_ETH })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(503);
    expect(error.code).toBe('USDC_PAYMENTS_UNAVAILABLE');
    expect(error.message).toMatch(/Pay in AI3/);
  });

  it('does not mistake the plain error shape for a code', async () => {
    // The HttpError default sends `{ error: <message> }` — prose in the same key
    // a coded error puts a code in. Without the two-key guard, a caller
    // branching on `code` would compare against a whole sentence: no match, but
    // a `code` that looks meaningful in a debugger.
    mockFetchResponse(
      400,
      { error: 'Invalid requestedBytes: 0 — must be a positive number of bytes' },
      'Bad Request',
    );

    const error = await api.createIntent({ requestedBytes: 0n }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBeUndefined();
    // The sentence still reaches the user, as it did before.
    expect(error.message).toMatch(/must be a positive number of bytes/);
  });
});

// ---------------------------------------------------------------------------
// watchIntent
// ---------------------------------------------------------------------------

describe('watchIntent error surfacing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthSession.mockResolvedValue({
      authProvider: 'google',
      accessToken: 'token',
    } as unknown as Awaited<ReturnType<typeof getAuthSession>>);
  });

  it('throws an ApiError carrying the status, so a 410 is distinguishable', async () => {
    // 410 is the backend refusing to record a hash against a lapsed price lock
    // (isIntentExpired → GoneError). A payment is already on chain at that
    // point, so this is the earliest notice it will not be credited — the USDC
    // panel shows the expiry message at once rather than six confirmations of
    // progress first. A bare Error would have thrown that status away.
    mockFetchResponse(410, {}, 'Gone');

    const error = await api.watchIntent('0xintent', '0xhash').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(410);
  });

  it('still throws for other failures, so nothing else changes shape', async () => {
    mockFetchResponse(500, {}, 'Internal Server Error');

    const error = await api.watchIntent('0xintent', '0xhash').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    // Both callers swallow anything that is not a 410, which is why the message
    // stays the generic one rather than becoming a sentence for a buyer.
    expect(error.message).toMatch(/Network response was not ok/);
  });
});
