import { jest } from '@jest/globals'
import express from 'express'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { HDNodeWallet, Wallet } from 'ethers'
import jwt from 'jsonwebtoken'
import { SiweMessage } from 'siwe'
import { config } from '../src/config.js'
import { userController } from '../src/controllers/user.js'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { Web3Auth } from '../src/services/authManager/providers/web3.js'
import { OrganizationsUseCases, UsersUseCases } from '../src/useCases/index.js'
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
    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Nonce already used',
    )
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

    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Unknown or expired nonce',
    )
  })

  it('rejects an expired nonce', async () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(Date.now() - TEN_MINUTES_MS - 1000)
    const { nonce } = Web3Auth.createNonce()
    const message = createMessage(wallet.address, nonce)
    const signature = await wallet.signMessage(message)
    const token = encodeProof({ address: wallet.address, message, signature })

    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Unknown or expired nonce',
    )
  })

  it('rejects messages for other origins', async () => {
    const token = await signProof(wallet, {
      domain: 'example.com',
      uri: 'https://example.com',
    })

    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Unexpected origin',
    )
  })

  it('rejects a domain that does not match the origin', async () => {
    const token = await signProof(wallet, { domain: 'example.com' })

    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Domain does not match',
    )
  })

  it('rejects messages for other chains', async () => {
    const token = await signProof(wallet, { chainId: 1 })

    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Unexpected chain',
    )
  })

  it('rejects an expired message', async () => {
    const token = await signProof(wallet, {
      expirationTime: new Date(Date.now() - 1000).toISOString(),
    })

    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Expired message',
    )
  })

  it('rejects a signature from another wallet', async () => {
    const other = Wallet.createRandom()
    const { nonce } = Web3Auth.createNonce()
    const message = createMessage(wallet.address, nonce)
    const signature = await other.signMessage(message)
    const token = encodeProof({ address: wallet.address, message, signature })

    await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
      'Invalid signature',
    )
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

    beforeAll(async () => {
      partnerId = (await OrganizationsUseCases.createOrganization('Partner')).id
      otherPartnerId = (await OrganizationsUseCases.createOrganization('Other'))
        .id
      config.web3Auth.partnerOrigins.set(PARTNER_ORIGIN, partnerId)
      config.web3Auth.partnerOrigins.set(OTHER_PARTNER_ORIGIN, otherPartnerId)

      const app = express()
      app.use(express.json())
      app.use('/users', userController)
      server = app.listen(0)
      await new Promise((resolve) => server.once('listening', resolve))
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    afterAll(async () => {
      config.web3Auth.partnerOrigins.clear()
      await new Promise((resolve) => server.close(resolve))
    })

    it('gives an end user a 1-hour access token for the partner origin', async () => {
      const wallet = Wallet.createRandom()
      await enroll(wallet)
      const token = await signProof(wallet, forOrigin(PARTNER_ORIGIN))

      const response = await fetch(`${baseUrl}/users/@me/accessToken`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Auth-Provider': 'web3-wallet',
        },
      })

      expect(response.status).toBe(200)
      const { accessToken } = await response.json()
      const payload = jwt.decode(accessToken) as jwt.JwtPayload
      expect(payload).toMatchObject({
        oauthProvider: 'web3-wallet',
        oauthUserId: wallet.address,
      })
      expect(payload.exp! - payload.iat!).toBe(60 * 60)
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

    it('refuses a wallet that is not an end user', async () => {
      const wallet = Wallet.createRandom()
      const token = await signProof(wallet, forOrigin(PARTNER_ORIGIN))

      await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
        'Origin not allowed for this address',
      )
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

      await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
        'Origin not allowed for this address',
      )
    })

    it('refuses an end user at the explorer', async () => {
      const wallet = Wallet.createRandom()
      await enroll(wallet)
      const token = await signProof(wallet)

      await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
        'Origin not allowed for this address',
      )
    })

    it('refuses an end user for another partner origin', async () => {
      const wallet = Wallet.createRandom()
      await enroll(wallet)
      const token = await signProof(wallet, forOrigin(OTHER_PARTNER_ORIGIN))

      await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
        'Origin not allowed for this address',
      )
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
      await expect(Web3Auth.getUserFromAccessToken(token)).rejects.toThrow(
        'Origin not allowed for this address',
      )

      await enroll(wallet)

      await expect(Web3Auth.getUserFromAccessToken(token)).resolves.toBeTruthy()
    })
  })
})
