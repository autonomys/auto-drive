import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { intentsController } from '../../../src/app/controllers/intents.js'
import { jest } from '@jest/globals'
import { Router } from 'express'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import {
  type UserWithOrganization,
  type User,
  AccountModel,
} from '@auto-drive/models'

// Mock Express for isolated testing of controller logic.
// We'll directly invoke the controller's route handlers with mock req/res.

const getRouteHandler = (router: Router, method: string, path = '/') => {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  )
  if (!layer) {
    throw new Error(`${method.toUpperCase()} ${path} handler not found`)
  }
  return layer.route.stack[0].handle as (
    req: any,
    res: any,
    next?: any,
  ) => Promise<void>
}

const createMockReq = (user: User | null) => {
  return {
    body: {},
    params: {} as Record<string, string>,
    headers: {},
    user,
  } as any
}

const createMockRes = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    sendStatus: jest.fn().mockReturnThis(),
  } as any
  return res
}

describe('POST /intents - Google-auth gate', () => {
  beforeEach(async () => {
    mockRabbitPublish()
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
    const response = res.json.mock.calls[0][0]
    expect(response).toHaveProperty('id')
    expect(response.status).toBe('PENDING')
  })
})

describe('Purchase credit end-to-end flow for Monthly accounts', () => {
  beforeEach(async () => {
    mockRabbitPublish()
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

    const intentResponse = res.json.mock.calls[0][0]
    const intentId = intentResponse.id

    // Step 2: Simulate on-chain confirmation by creating a purchased_credits row.
    const creditBytes = BigInt(10 * 1024 * 1024) // 10 MB
    await db.query(
      `INSERT INTO intents (id, user_public_id, status, shannons_per_byte, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [intentId, googleUserMonthly.publicId, 'COMPLETED', '1', new Date()],
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
        'upload' as any,
      )
    expect(pendingCredits).toBeGreaterThanOrEqual(Number(creditBytes))

    // Step 4: Register an upload interaction (simulates consumption).
    const uploadSize = BigInt(5 * 1024 * 1024) // 5 MB
    await AccountsUseCases.registerInteraction(
      googleUserMonthly,
      'upload' as any,
      uploadSize,
    )

    // Step 5: Verify remaining credits after consumption.
    const afterConsumption =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        googleUserMonthly,
        'upload' as any,
      )
    expect(afterConsumption).toBeLessThan(pendingCredits)
    expect(pendingCredits - afterConsumption).toBe(Number(uploadSize))
  })
})
