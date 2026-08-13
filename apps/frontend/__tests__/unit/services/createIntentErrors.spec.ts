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

import { createApiService } from '../../../src/services/api';
import { getAuthSession } from 'utils/auth';

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

    await expect(api.createIntent(3221225472n)).rejects.toThrow(
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

    await expect(api.createIntent(1n)).rejects.toThrow(
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

    await expect(api.createIntent(1n)).rejects.toThrow(
      'Network response was not ok: Internal Server Error',
    );
    await expect(api.createIntent(1n)).rejects.not.toThrow(/ECONNREFUSED/);
  });

  it('still surfaces an uncoded 4xx, which describes the request', async () => {
    // The plain shape on a 4xx is a sentence about what was sent, not about our
    // plumbing, so it stays useful.
    mockFetchResponse(
      400,
      { error: 'Invalid requestedBytes: 0 — must be a positive number of bytes' },
      'Bad Request',
    );

    await expect(api.createIntent(0n)).rejects.toThrow(
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

    await expect(api.createIntent(1n)).rejects.toThrow(
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

    await api.createIntent(1_073_741_824n);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({ requestedBytes: '1073741824' }),
    );

    await api.createIntent();
    expect(
      JSON.parse(fetchMock.mock.calls[1][1].body),
    ).not.toHaveProperty('requestedBytes');
  });
});
