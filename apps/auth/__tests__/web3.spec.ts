import { jest } from '@jest/globals'
import { HDNodeWallet, Wallet } from 'ethers'
import jwt from 'jsonwebtoken'
import { SiweMessage } from 'siwe'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { Web3Auth } from '../src/services/authManager/providers/web3.js'
import { dbMigration } from './utils/dbMigrate.js'

const ORIGIN = 'https://explorer.ai3.storage'
const TEN_MINUTES_MS = 10 * 60 * 1000

const createMessage = (
  address: string,
  nonce: string,
  overrides: Partial<SiweMessage> = {},
) =>
  new SiweMessage({
    address,
    chainId: 490000,
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
})
