import { OAuthUser } from '@auto-drive/models'
import { randomBytes } from 'crypto'
import jwt from 'jsonwebtoken'
import { SiweMessage } from 'siwe'
import { config } from '../../../config.js'
import { walletNoncesRepository } from '../../../repositories/index.js'

// The wallet proof is exchanged for a session right after it is signed
const NONCE_TTL_MS = 10 * 60 * 1000
const CHAIN_ID = 490000

interface Web3AuthToken {
  address: string
  message: string
  signature: string
}

export const createNonce = async () => {
  const nonce = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS)

  await walletNoncesRepository.createNonce(nonce, expiresAt)

  return { nonce, expiresAt: expiresAt.toISOString() }
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

  const { success, error } = await siweMessage.verify(
    { signature, domain: new URL(origin).host },
    { suppressExceptions: true },
  )

  if (!success) throw new Error(`Invalid signature: ${error?.type}`)
  if (address !== siweMessage.address) throw new Error('Address mismatch')

  const isNonceValid = await walletNoncesRepository.consumeNonce(
    siweMessage.nonce,
  )
  if (!isNonceValid) throw new Error('Unknown or expired nonce')

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
