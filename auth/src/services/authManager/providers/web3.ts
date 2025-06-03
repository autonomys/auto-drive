import { OAuthUser } from '@auto-drive/models'
import jwt from 'jsonwebtoken'
import { SiweMessage } from 'siwe'

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

  return {
    provider: 'auto-evm',
    id: address,
    username: address,
  }
}

export const Web3Auth = {
  getUserFromAccessToken,
}
