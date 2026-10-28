import {
  describe,
  it,
  expect,
  jest,
  beforeAll,
  afterAll,
  afterEach,
} from '@jest/globals'
import express from 'express'
import { AddressInfo } from 'net'
import { Server } from 'http'
import {
  ObjectInformation,
  ObjectSummary,
  OwnerRole,
  UserRole,
} from '@auto-drive/models'
import { objectController } from '../../../src/app/controllers/object.js'
import { ObjectUseCases } from '../../../src/core/index.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { createMockUser } from '../../utils/mocks.js'

describe('Object routes and owners', () => {
  const owner = createMockUser()
  const sharee = createMockUser()
  const admin = { ...createMockUser(), role: UserRole.Admin }

  const owners = [
    {
      oauthProvider: owner.oauthProvider,
      oauthUserId: owner.oauthUserId,
      role: OwnerRole.ADMIN,
    },
    {
      oauthProvider: sharee.oauthProvider,
      oauthUserId: sharee.oauthUserId,
      role: OwnerRole.VIEWER,
    },
  ]

  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    const app = express()
    app.use('/objects', objectController)
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const mockObject = () => {
    jest.spyOn(ObjectUseCases, 'isObjectDeleted').mockResolvedValue(false)
    jest
      .spyOn(ObjectUseCases, 'getObjectInformation')
      .mockResolvedValue({ cid: 'bafkreiobject', owners } as ObjectInformation)
    jest
      .spyOn(ObjectUseCases, 'getObjectSummaryByCID')
      .mockResolvedValue({ headCid: 'bafkreiobject', owners } as ObjectSummary)
  }

  const getOwners = async (path: string, viewer?: typeof owner) => {
    const headers: Record<string, string> = {}
    if (viewer) {
      jest
        .spyOn(AuthManager, 'getUserFromAccessToken')
        .mockResolvedValue(viewer)
      headers.authorization = 'Bearer token'
      headers['x-auth-provider'] = 'apikey'
    }

    const response = await fetch(`${baseUrl}${path}`, { headers })
    expect(response.status).toBe(200)

    return ((await response.json()) as { owners: unknown[] }).owners
  }

  it.each(['/objects/bafkreiobject', '/objects/bafkreiobject/summary'])(
    'scopes owners on %s to the viewer',
    async (path) => {
      mockObject()

      expect(await getOwners(path)).toEqual([])
      expect(await getOwners(path, owner)).toEqual([owners[0]])
      expect(await getOwners(path, sharee)).toEqual([owners[1]])
      expect(await getOwners(path, admin)).toEqual(owners)
    },
  )
})
