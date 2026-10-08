import { jest } from '@jest/globals'
import { Request, Response } from 'express'
import { v4 } from 'uuid'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { AuthManager } from '../src/services/authManager/index.js'
import { handleAuth } from '../src/services/authManager/express.js'
import { UsersUseCases } from '../src/useCases/index.js'
import { dbMigration } from './utils/dbMigrate.js'
import { MOCK_UNONBOARDED_USER } from './utils/mocks.js'

const mockRequest = () =>
  ({
    headers: { authorization: 'Bearer token', 'x-auth-provider': 'google' },
  }) as unknown as Request

const mockResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }
  return res as unknown as Response & typeof res
}

const signInAs = (oauthUserId: string) =>
  jest
    .spyOn(AuthManager, 'getUserFromAccessToken')
    .mockResolvedValue({ provider: 'google', id: oauthUserId })

describe('handleAuth', () => {
  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
  })

  afterAll(async () => {
    jest.restoreAllMocks()
    await closeDatabase()
    await dbMigration.down()
  })

  it('responds 403 for a user who has not onboarded', async () => {
    signInAs(v4())
    const res = mockResponse()

    const user = await handleAuth(mockRequest(), res)

    expect(user).toBeNull()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'User not onboarded' })
  })

  it('returns the user without responding once onboarded', async () => {
    const oauthUserId = v4()
    await UsersUseCases.onboardUser({ ...MOCK_UNONBOARDED_USER, oauthUserId })
    signInAs(oauthUserId)
    const res = mockResponse()

    const user = await handleAuth(mockRequest(), res)

    expect(user).toMatchObject({ oauthUserId, onboarded: true })
    expect(res.status).not.toHaveBeenCalled()
  })
})
