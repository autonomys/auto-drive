import { OAuthUser } from '@auto-drive/models'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import jwt from 'jsonwebtoken'
import { SiweMessage } from 'siwe'
import { config } from '../../../config.js'
import { walletNoncesRepository } from '../../../repositories/index.js'

// The wallet proof is exchanged for a session right after it is signed
const NONCE_TTL_SECONDS = 10 * 60
const CHAIN_ID = 490000

interface Web3AuthToken {
  address: string
  message: string
  signature: string
}

// A nonce is `<expiry><random><mac>` in hex, so issuing one needs no storage.
// A nonce is stored only when a sign-in uses it.
const NONCE_PATTERN = /^[0-9a-f]{72}$/
const PAYLOAD_LENGTH = 40

const nonceMac = (payload: string) =>
  createHmac('sha256', config.jwtSecret)
    .update(`wallet-nonce:${payload}`)
    .digest()
    .subarray(0, 16)

export const createNonce = () => {
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + NONCE_TTL_SECONDS
  const payload =
    expiresAtSeconds.toString(16).padStart(8, '0') +
    randomBytes(16).toString('hex')

  return {
    nonce: payload + nonceMac(payload).toString('hex'),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  }
}

// Returns when the nonce expires, or null if it was not issued here or has
// expired
const parseNonce = (nonce: string): Date | null => {
  if (!NONCE_PATTERN.test(nonce)) return null

  const payload = nonce.slice(0, PAYLOAD_LENGTH)
  const mac = Buffer.from(nonce.slice(PAYLOAD_LENGTH), 'hex')
  if (!timingSafeEqual(mac, nonceMac(payload))) return null

  const expiresAt = new Date(parseInt(payload.slice(0, 8), 16) * 1000)
  return expiresAt > new Date() ? expiresAt : null
}

export const getUserFromAccessToken = async (
  accessToken: string,
): Promise<OAuthUser> => {
  const decoded = jwt.decode(accessToken)
  if (!decoded) throw new Error('Invalid token')
  if (typeof decoded !== 'object') throw new Error('Invalid token')

  const { address, message, signature } = decoded as Web3AuthToken

  const siweMessage = new SiweMessage(message)
  const origin = new URL(siweMessage.uri).origin
  if (!config.web3Auth.allowedOrigins.includes(origin))
    throw new Error(`Unexpected origin: ${origin}`)
  if (siweMessage.chainId !== CHAIN_ID) throw new Error('Unexpected chain')

  const nonceExpiresAt = parseNonce(siweMessage.nonce)
  if (!nonceExpiresAt) throw new Error('Unknown or expired nonce')

  const { success, error } = await siweMessage.verify(
    { signature, domain: new URL(origin).host },
    { suppressExceptions: true },
  )

  if (!success) throw new Error(`Invalid signature: ${error?.type}`)
  if (address !== siweMessage.address) throw new Error('Address mismatch')

  const isFirstUse = await walletNoncesRepository.markNonceUsed(
    siweMessage.nonce,
    nonceExpiresAt,
  )
  if (!isFirstUse) throw new Error('Nonce already used')

  return {
    provider: 'web3-wallet',
    id: siweMessage.address,
    username: siweMessage.address,
  }
}

export const Web3Auth = {
  createNonce,
  getUserFromAccessToken,
}
