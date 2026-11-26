import { jest } from '@jest/globals'
import express from 'express'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { HDNodeWallet, Wallet } from 'ethers'
import jwt from 'jsonwebtoken'
import { SiweMessage } from 'siwe'
import { userController } from '../src/controllers/user.js'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import {
  Web3Auth,
  Web3SignInRefused,
  Web3SignInRefusalReason,
} from '../src/services/authManager/providers/web3.js'
import {
  OrganizationsUseCases,
  PartnerOriginsUseCases,
  UsersUseCases,
} from '../src/useCases/index.js'
import { DeletionUseCases } from '../src/useCases/deletion.js'
import { User } from '@auto-drive/models'
import { dbMigration } from './utils/dbMigrate.js'
import { createUnonboardedUser } from './utils/mocks.js'

const ORIGIN = 'https://explorer.ai3.storage'
const PARTNER_ORIGIN = 'https://app.partner.example'
const OTHER_PARTNER_ORIGIN = 'https://app.other-partner.example'
const TEN_MINUTES_MS = 10 * 60 * 1000

const createMessage = (
  address: string,
  nonce: string,
  overrides: Partial<SiweMessage> = {},
) =>
  new SiweMessage({
    address,
    chainId: 870,
    domain: new URL(ORIGIN).host,
    statement: 'Sign in to Auto Drive.',
    uri: ORIGIN,
    version: '1',
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + TEN_MINUTES_MS).toISOString(),
    ...overrides,
  }).prepareMessage()

// A refusal after the signature verified, with the reason it gives.
const expectRefused = async (
  token: string,
  reason: Web3SignInRefusalReason,
) => {
  const error = await Web3Auth.getUserFromAccessToken(token).then(
    () => null,
    (e) => e,
  )
  expect(error).toBeInstanceOf(Web3SignInRefused)
  expect(error.reason).toBe(reason)
}

// Mirrors encodeWalletProofInJWT in the frontend
const encodeProof = (proof: object) =>
  jwt.sign(JSON.stringify(proof), '<secret>', { algorithm: 'none' })

const signProof = async (
  wallet: HDNodeWallet,
  overrides: Partial<SiweMessage> = {},
  address: string = wallet.address,
) => {
  const { nonce } = Web3Auth.createNonce()
  const message = createMessage(wallet.address, nonce, overrides)
  const signature = await wallet.signMessage(message)

  return encodeProof({ address, message, signature })
}

describe('Web3Auth', () => {
  const wallet = Wallet.createRandom()

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })

  it('issues random nonces that expire in ten minutes', () => {
    const first = Web3Auth.createNonce()
    const second = Web3Auth.createNonce()

    expect(first.nonce).toMatch(/^[0-9a-f]{72}$/)
    expect(first.nonce).not.toEqual(second.nonce)

    const ttl = Date.parse(first.expiresAt) - Date.now()
    expect(ttl).toBeGreaterThan(TEN_MINUTES_MS - 60_000)
    expect(ttl).toBeLessThanOrEqual(TEN_MINUTES_MS)
  })

  it('signs in with a valid proof', async () => {
    const token = await signProof(wallet)

    await expect(Web3Auth.getUserFromAccessToken(token)).resolves.toEqual({
      provider: 'web3-wallet',
      id: wallet.address,
      username: wallet.address,
    })
  })

  it('accepts each proof only once', async () => {
    const token = await signProof(wallet)

    await expect(Web3Auth.getUserFromAccessToken(token)).resolves.toBeTruthy()
    await expectRefused(token, 'nonce_expired')
  })

  it('requires the address to match the signed message', async () => {
    const other = Wallet.createRandom()
    const token = await signProof(wallet, {}, other.address)

    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Address mismatch',
    )
  })

  it('rejects a nonce that was not issued', async () => {
    const { nonce } = Web3Auth.createNonce()
    const forged = nonce.slice(0, -1) + (nonce.endsWith('0') ? '1' : '0')
    const message = createMessage(wallet.address, forged)
    const signature = await wallet.signMessage(message)
    const token = encodeProof({ address: wallet.address, message, signature })

    await expectRefused(token, 'nonce_expired')
  })

  it('rejects an expired nonce', async () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(Date.now() - TEN_MINUTES_MS - 1000)
    const { nonce } = Web3Auth.createNonce()
    const message = createMessage(wallet.address, nonce)
    const signature = await wallet.signMessage(message)
    const token = encodeProof({ address: wallet.address, message, signature })

    await expectRefused(token, 'nonce_expired')
  })

  it('rejects messages for other origins', async () => {
    const token = await signProof(wallet, {
      domain: 'example.com',
      uri: 'https://example.com',
    })

    await expectRefused(token, 'origin_not_allowed')
  })

  it('rejects a domain that does not match the origin', async () => {
    const token = await signProof(wallet, { domain: 'example.com' })

    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Domain does not match',
    )
  })

  it('rejects messages for other chains', async () => {
    const token = await signProof(wallet, { chainId: 1 })

    await expectRefused(token, 'chain_not_allowed')
  })

  // Until explorer tabs opened before it moved to 870 age out.
  it('accepts the old chain ID 490000 at the explorer', async () => {
    const token = await signProof(wallet, { chainId: 490000 })

    await expect(Web3Auth.getUserFromAccessToken(token)).resolves.toEqual({
      provider: 'web3-wallet',
      id: wallet.address,
      username: wallet.address,
    })
  })

  it('rejects an expired message as needing a new sign-in', async () => {
    const token = await signProof(wallet, {
      issuedAt: new Date(Date.now() - 2000).toISOString(),
      expirationTime: new Date(Date.now() - 1000).toISOString(),
    })

    await expectRefused(token, 'nonce_expired')
  })

  it('gives no reason for an expired message signed by another wallet', async () => {
    const { nonce } = Web3Auth.createNonce()
    const message = createMessage(wallet.address, nonce, {
      issuedAt: new Date(Date.now() - 2000).toISOString(),
      expirationTime: new Date(Date.now() - 1000).toISOString(),
    })
    const signature = await Wallet.createRandom().signMessage(message)
    const token = encodeProof({ address: wallet.address, message, signature })

    const error = await Web3Auth.getUserFromAccessToken(token).then(
      () => null,
      (e) => e,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(Web3SignInRefused)
  })

  it('rejects a signature from another wallet', async () => {
    const other = Wallet.createRandom()
    const { nonce } = Web3Auth.createNonce()
    const message = createMessage(wallet.address, nonce)
    const signature = await other.signMessage(message)
    const token = encodeProof({ address: wallet.address, message, signature })

    const error = await Web3Auth.getUserFromAccessToken(token).then(
      () => null,
      (e) => e,
    )
    expect(error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Invalid signature'),
      }),
    )
    // Nothing is said about why to a caller who doesn't hold the key.
    expect(error).not.toBeInstanceOf(Web3SignInRefused)
  })

  describe('Web3Auth partner origins', () => {
    let server: Server
    let baseUrl: string
    let partnerId: string
    let otherPartnerId: string

    const forOrigin = (origin: string): Partial<SiweMessage> => ({
      domain: new URL(origin).host,
      uri: origin,
    })

    const enroll = async (wallet: HDNodeWallet, organizationId = partnerId) =>
      OrganizationsUseCases.enrollEndUsers({
        organizationId,
        endUsers: [
          {
            address: wallet.address,
            customerReference: wallet.address,
            uploadQuotaBytes: null,
          },
        ],
        maxEndUsers: 100,
        actor: 'test',
      })

    const signIn = (token: string) =>
      fetch(`${baseUrl}/users/@me/accessToken`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Auth-Provider': 'web3-wallet',
        },
      })

    beforeAll(async () => {
      partnerId = (await OrganizationsUseCases.createOrganization('Partner')).id
      otherPartnerId = (await OrganizationsUseCases.createOrganization('Other'))
        .id
      await PartnerOriginsUseCases.addOrigin({
        organizationId: partnerId,
        origin: PARTNER_ORIGIN,
        actor: 'test',
      })
      await PartnerOriginsUseCases.addOrigin({
        organizationId: otherPartnerId,
        origin: OTHER_PARTNER_ORIGIN,
        actor: 'test',
      })

      const app = express()
      app.use(express.json())
      app.use('/users', userController)
      server = app.listen(0)
      await new Promise((resolve) => server.once('listening', resolve))
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve))
    })

    it('gives an end user a 1-hour access token for the partner origin', async () => {
      const wallet = Wallet.createRandom()
      await enroll(wallet)
      const token = await signProof(wallet, forOrigin(PARTNER_ORIGIN))

      const response = await signIn(token)

      expect(response.status).toBe(200)
      const { accessToken } = await response.json()
      const payload = jwt.decode(accessToken) as jwt.JwtPayload
      expect(payload).toMatchObject({
        oauthProvider: 'web3-wallet',
        oauthUserId: wallet.address,
      })
      expect(payload.exp! - payload.iat!).toBe(60 * 60)
    })

    it('tells the caller why a sign-in was refused', async () => {
      const wallet = Wallet.createRandom()
      const token = await signProof(wallet, forOrigin(PARTNER_ORIGIN))

      const response = await signIn(token)

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: 'Failed to authenticate user',
        reason: 'not_enrolled',
      })
    })

    it('gives no reason for a signature that does not verify', async () => {
      const wallet = Wallet.createRandom()
      const { nonce } = Web3Auth.createNonce()
      const message = createMessage(
        wallet.address,
        nonce,
        forOrigin(PARTNER_ORIGIN),
      )
      const token = encodeProof({
        address: wallet.address,
        message,
        signature: await Wallet.createRandom().signMessage(message),
      })

      const response = await signIn(token)

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: 'Failed to authenticate user',
      })
    })

    it('accepts a removed end user', async () => {
      const wallet = Wallet.createRandom()
      await enroll(wallet)
      await OrganizationsUseCases.removeEndUser({
        organizationId: partnerId,
        address: wallet.address,
        actor: 'test',
      })
      const token = await signProof(wallet, forOrigin(PARTNER_ORIGIN))

      await expect(Web3Auth.getUserFromAccessToken(token)).resolves.toEqual({
        provider: 'web3-wallet',
        id: wallet.address,
        username: wallet.address,
      })
    })

    it('keeps read-only sign-in after the partner organization is archived', async () => {
      const archivedId = (
        await OrganizationsUseCases.createOrganization('Archived partner')
      ).id
      const origin = 'https://app.archived-partner.example'
      await PartnerOriginsUseCases.addOrigin({
        organizationId: archivedId,
        origin,
        actor: 'test',
      })
      const wallet = Wallet.createRandom()
      await enroll(wallet, archivedId)
      const db = await getDatabase()
      await db.query(
        'UPDATE users.organizations SET archived_at = NOW() WHERE id = $1',
        [archivedId],
      )

      const token = await signProof(wallet, forOrigin(origin))
      const oauthUser = await Web3Auth.getUserFromAccessToken(token)
      const user = await UsersUseCases.getUserByOAuthUser(oauthUser)
      const withOrganization = await UsersUseCases.getUserWithOrganization(
        user.publicId!,
      )

      expect(withOrganization).toMatchObject({
        organizationId: archivedId,
        endUserRemovedAt: expect.any(String),
      })
    })

    it('refuses a wallet that is not an end user', async () => {
      const wallet = Wallet.createRandom()
      const token = await signProof(wallet, forOrigin(PARTNER_ORIGIN))

      await expectRefused(token, 'not_enrolled')
    })

    it('refuses a wallet user who signed up at the explorer', async () => {
      const wallet = Wallet.createRandom()
      await UsersUseCases.onboardUser({
        ...createUnonboardedUser(),
        oauthProvider: 'web3-wallet',
        oauthUserId: wallet.address,
        oauthUsername: wallet.address,
      })
      const token = await signProof(wallet, forOrigin(PARTNER_ORIGIN))

      await expectRefused(token, 'not_enrolled')
    })

    it('refuses an end user at the explorer', async () => {
      const wallet = Wallet.createRandom()
      await enroll(wallet)
      const token = await signProof(wallet)

      await expectRefused(token, 'origin_not_allowed')
    })

    it('refuses an end user who closed their account at the explorer', async () => {
      const wallet = Wallet.createRandom()
      await enroll(wallet)
      const user = await UsersUseCases.getUserByOAuthUser({
        provider: 'web3-wallet',
        id: wallet.address,
      })
      const request = await DeletionUseCases.requestDeletion(user as User)
      await DeletionUseCases.markAsProcessing(request.id)
      await DeletionUseCases.anonymiseUser(request.id)
      const token = await signProof(wallet)

      await expectRefused(token, 'origin_not_allowed')
    })

    it('refuses an end user for another partner origin', async () => {
      const wallet = Wallet.createRandom()
      await enroll(wallet)
      const token = await signProof(wallet, forOrigin(OTHER_PARTNER_ORIGIN))

      // As for anyone who isn't that partner's end user, so the partner's app
      // doesn't learn that they are another partner's.
      await expectRefused(token, 'not_enrolled')
    })

    it('accepts chain ID 870 only at a partner origin', async () => {
      const wallet = Wallet.createRandom()
      await enroll(wallet)

      for (const chainId of [490000, 1]) {
        const token = await signProof(wallet, {
          ...forOrigin(PARTNER_ORIGIN),
          chainId,
        })
        await expectRefused(token, 'chain_not_allowed')
      }
    })

    it('does not use up the nonce of a refused sign-in', async () => {
      const wallet = Wallet.createRandom()
      const { nonce } = Web3Auth.createNonce()
      const message = createMessage(
        wallet.address,
        nonce,
        forOrigin(PARTNER_ORIGIN),
      )
      const token = encodeProof({
        address: wallet.address,
        message,
        signature: await wallet.signMessage(message),
      })
      await expectRefused(token, 'not_enrolled')

      await enroll(wallet)

      await expect(Web3Auth.getUserFromAccessToken(token)).resolves.toBeTruthy()
    })
  })
})
