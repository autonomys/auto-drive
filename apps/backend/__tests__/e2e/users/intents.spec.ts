import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { intentsController } from '../../../src/app/controllers/intents.js'
import { jest } from '@jest/globals'
import type { Router, NextFunction } from 'express'
import type { Mock } from 'jest-mock'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { IntentsUseCases } from '../../../src/core/users/intents.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import {
  type UserWithOrganization,
  type User,
  AccountModel,
  IntentStatus,
  InteractionType,
} from '@auto-drive/models'

// Mock Express for isolated testing of controller logic.
// We'll directly invoke the controller's route handlers with mock req/res.

interface RouteLayer {
  route?: {
    path: string
    methods: Record<string, boolean>
    stack: Array<{ handle: (...args: unknown[]) => Promise<void> }>
  }
}

type TestHandler = (
  req: MockRequest,
  res: MockResponse,
  next?: NextFunction,
) => Promise<void>

const getRouteHandler = (router: Router, method: string, path = '/'): TestHandler => {
  const layer = (router as unknown as { stack: RouteLayer[] }).stack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method],
  )
  if (!layer) {
    throw new Error(`${method.toUpperCase()} ${path} handler not found`)
  }
  return layer.route!.stack[0].handle as unknown as TestHandler
}

interface MockRequest extends Record<string, unknown> {
  body: Record<string, unknown>
  params: Record<string, string>
  headers: Record<string, string>
  user: User | null
}

interface MockResponse extends Record<string, unknown> {
  status: Mock
  json: Mock
  send: Mock
  sendStatus: Mock
}

const createMockReq = (user: User | null): MockRequest => {
  return {
    body: {},
    params: {},
    headers: {
      authorization: 'Bearer mock-token',
      'x-auth-provider': 'google',
    },
    user,
  }
}

const createMockRes = (): MockResponse => {
  return {
    status: jest.fn().mockReturnThis() as unknown as Mock,
    json: jest.fn().mockReturnThis() as unknown as Mock,
    send: jest.fn().mockReturnThis() as unknown as Mock,
    sendStatus: jest.fn().mockReturnThis() as unknown as Mock,
  }
}

describe('POST /intents - Google-auth gate', () => {
  beforeEach(async () => {
    mockRabbitPublish()
    jest.spyOn(IntentsUseCases, 'getPrice').mockResolvedValue({
      price: 1,
      pricePerGB: 1073741824,
    })
    await getDatabase()
    await dbMigration.up()
  })

  afterEach(async () => {
    unmockMethods()
    await dbMigration.down()
  })

  it('should reject non-Google users with 403 GOOGLE_ACCOUNT_REQUIRED when buyCredits is active', async () => {
    // Create a Discord-registered user.
    const discordUser: UserWithOrganization = {
      ...createMockUser(),
      oauthProvider: 'discord',
    }
    await AccountsUseCases.getOrCreateAccount(discordUser)
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(discordUser)

    // Directly invoke the POST /intents handler.
    const req = createMockReq(discordUser)
    const res = createMockRes()

    const postIntentHandler = getRouteHandler(intentsController, 'post')
    await postIntentHandler(req, res)

    // Verify the 403 response with GOOGLE_ACCOUNT_REQUIRED.
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'GOOGLE_ACCOUNT_REQUIRED',
      }),
    )
  })

  it('should accept Google users regardless of account model', async () => {
    // Create a Google-registered user with OneOff model.
    const googleUserOneOff: UserWithOrganization = {
      ...createMockUser(),
      oauthProvider: 'google',
    }
    const accountOneOff =
      await AccountsUseCases.getOrCreateAccount(googleUserOneOff)
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(googleUserOneOff)

    // Invoke the handler for OneOff.
    const req1 = createMockReq(googleUserOneOff)
    const res1 = createMockRes()

    const postIntentHandler = getRouteHandler(intentsController, 'post')
    await postIntentHandler(req1, res1)

    // Verify success (200) for Google user with OneOff.
    expect(res1.status).toHaveBeenCalledWith(200)
    expect(res1.json).toHaveBeenCalled()
    const oneOffResponse = res1.json.mock.calls[0][0]
    expect(oneOffResponse).toHaveProperty('id')
    expect(oneOffResponse).toHaveProperty('status')

    // Now test with the same Google user converted to Monthly.
    const db = await getDatabase()
    await db.query(
      'UPDATE accounts SET model = $1 WHERE id = $2',
      [AccountModel.Monthly, accountOneOff.id],
    )

    const req2 = createMockReq(googleUserOneOff)
    const res2 = createMockRes()

    await postIntentHandler(req2, res2)

    // Verify success (200) for Google user with Monthly.
    expect(res2.status).toHaveBeenCalledWith(200)
    expect(res2.json).toHaveBeenCalled()
    const monthlyResponse = res2.json.mock.calls[0][0]
    expect(monthlyResponse).toHaveProperty('id')
    expect(monthlyResponse).toHaveProperty('status')
  })

  it('should reject GitHub users with 403 regardless of account model', async () => {
    // Create a GitHub-registered user.
    const githubUser: UserWithOrganization = {
      ...createMockUser(),
      oauthProvider: 'github',
    }
    await AccountsUseCases.getOrCreateAccount(githubUser)
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(githubUser)

    const req = createMockReq(githubUser)
    const res = createMockRes()

    const postIntentHandler = getRouteHandler(intentsController, 'post')
    await postIntentHandler(req, res)

    // Verify the 403 response.
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'GOOGLE_ACCOUNT_REQUIRED',
      }),
    )
  })

  it('should reject web3-wallet users with 403 regardless of account model', async () => {
    // Create a web3-wallet user.
    const web3User: UserWithOrganization = {
      ...createMockUser(),
      oauthProvider: 'web3-wallet',
    }
    await AccountsUseCases.getOrCreateAccount(web3User)
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(web3User)

    const req = createMockReq(web3User)
    const res = createMockRes()

    const postIntentHandler = getRouteHandler(intentsController, 'post')
    await postIntentHandler(req, res)

    // Verify the 403 response.
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'GOOGLE_ACCOUNT_REQUIRED',
      }),
    )
  })

  it('Monthly accounts can successfully create intents when Google-registered', async () => {
    // Create a Google-registered user with Monthly account.
    const googleUserMonthly: UserWithOrganization = {
      ...createMockUser(),
      oauthProvider: 'google',
    }
    const account =
      await AccountsUseCases.getOrCreateAccount(googleUserMonthly)
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(googleUserMonthly)

    // Switch to Monthly.
    const db = await getDatabase()
    await db.query(
      'UPDATE accounts SET model = $1 WHERE id = $2',
      [AccountModel.Monthly, account.id],
    )

    const req = createMockReq(googleUserMonthly)
    const res = createMockRes()

    const postIntentHandler = getRouteHandler(intentsController, 'post')
    await postIntentHandler(req, res)

    // Verify success (200) for Monthly + Google.
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalled()
    const response = res.json.mock.calls[0][0] as Record<string, unknown>
    expect(response).toHaveProperty('id')
    expect(response.status).toBe(IntentStatus.PENDING)
  })
})

describe('Purchase credit end-to-end flow for Monthly accounts', () => {
  beforeEach(async () => {
    mockRabbitPublish()
    jest.spyOn(IntentsUseCases, 'getPrice').mockResolvedValue({
      price: 1,
      pricePerGB: 1073741824,
    })
    await getDatabase()
    await dbMigration.up()
  })

  afterEach(async () => {
    unmockMethods()
    await dbMigration.down()
  })

  it('Monthly account can create an intent, receive credits, and consume them on upload', async () => {
    // Setup: Google-registered Monthly account.
    const googleUserMonthly: UserWithOrganization = {
      ...createMockUser(),
      oauthProvider: 'google',
    }
    const account =
      await AccountsUseCases.getOrCreateAccount(googleUserMonthly)
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(googleUserMonthly)

    // Switch to Monthly model.
    const db = await getDatabase()
    await db.query(
      'UPDATE accounts SET model = $1 WHERE id = $2',
      [AccountModel.Monthly, account.id],
    )

    // Verify the account is Monthly.
    const accountAfter = await AccountsUseCases.getAccountById(account.id)
    expect(accountAfter?.model).toBe(AccountModel.Monthly)

    // Step 1: Create an intent (simulates POST /intents).
    const req = createMockReq(googleUserMonthly)
    const res = createMockRes()

    const postIntentHandler = getRouteHandler(intentsController, 'post')
    await postIntentHandler(req, res)
    expect(res.status).toHaveBeenCalledWith(200)

    const intentResponse = res.json.mock.calls[0][0] as Record<string, unknown>
    const intentId = intentResponse.id

    // Step 2: Simulate on-chain confirmation by transitioning the intent to COMPLETED.
    const creditBytes = BigInt(10 * 1024 * 1024) // 10 MB
    await db.query(
      'UPDATE intents SET status = $1 WHERE id = $2',
      ['COMPLETED', intentId],
    )
    await db.query(
      `INSERT INTO purchased_credits (account_id, intent_id, upload_bytes_original, upload_bytes_remaining, download_bytes_original, download_bytes_remaining, expires_at)
       VALUES ($1, $2, $3, $3, $4, $4, $5)`,
      [
        account.id,
        intentId,
        creditBytes.toString(),
        BigInt(0).toString(),
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      ],
    )

    // Step 3: Verify the Monthly account can see and consume purchased credits.
    const pendingCredits =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        googleUserMonthly,
        InteractionType.Upload,
      )
    expect(pendingCredits).toBeGreaterThanOrEqual(Number(creditBytes))

    // Step 4: Register an upload interaction (simulates consumption).
    const uploadSize = BigInt(5 * 1024 * 1024) // 5 MB
    await AccountsUseCases.registerInteraction(
      googleUserMonthly,
      InteractionType.Upload,
      uploadSize,
    )

    // Step 5: Verify remaining credits after consumption.
    const afterConsumption =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        googleUserMonthly,
        InteractionType.Upload,
      )
    expect(afterConsumption).toBeLessThan(pendingCredits)
    expect(pendingCredits - afterConsumption).toBe(Number(uploadSize))
  })
})
