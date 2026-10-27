import { OAuthUser } from '@auto-drive/models'
import jwt from 'jsonwebtoken'
import { SiweMessage } from 'siwe'

// The wallet proof is exchanged for a session right after it is signed
const MAX_PROOF_AGE_MS = 10 * 60 * 1000
const MAX_CLOCK_SKEW_MS = 60 * 1000

interface Web3AuthToken {
  address: string
  message: string
  signature: string
}

export const getUserFromAccessToken = async (
  accessToken: string,
): Promise<OAuthUser> => {
  const decoded = jwt.decode(accessToken)
  if (!decoded) throw new Error('Invalid token')
  if (typeof decoded !== 'object') throw new Error('Invalid token')

  const { address, message, signature } = decoded as Web3AuthToken

  const siweMessage = new SiweMessage(message)
  const { success, error } = await siweMessage.verify({
    signature,
    nonce: siweMessage.nonce,
  })

  if (!success) throw new Error(`Invalid signature: ${error}`)
  if (address !== siweMessage.address) throw new Error('Address mismatch')

  const issuedAt = Date.parse(siweMessage.issuedAt ?? '')
  const age = Date.now() - issuedAt
  if (
    Number.isNaN(issuedAt) ||
    age > MAX_PROOF_AGE_MS ||
    age < -MAX_CLOCK_SKEW_MS
  )
    throw new Error('Expired proof')

  return {
    provider: 'web3-wallet',
    id: siweMessage.address,
    username: siweMessage.address,
  }
}

export const Web3Auth = {
  getUserFromAccessToken,
}
