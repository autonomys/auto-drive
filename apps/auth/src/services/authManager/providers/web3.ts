import { OAuthUser, OrganizationRole } from '@auto-drive/models'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import jwt from 'jsonwebtoken'
import { SiweErrorType, SiweMessage } from 'siwe'
import { config } from '../../../config.js'
import {
  organizationMembersRepository,
  partnerOriginsRepository,
  walletNoncesRepository,
} from '../../../repositories/index.js'

// The wallet proof is exchanged for a session right after it is signed
const NONCE_TTL_SECONDS = 10 * 60
// Mainnet. Partner origins accept it alone.
const MAINNET_CHAIN_ID = 870
// The explorer's origins also accept 490000 while explorer tabs opened before
// it moved to mainnet's chain ID age out. Remove 490000 about a week after the
// explorer deploys (#983).
const EXPLORER_CHAIN_IDS = [MAINNET_CHAIN_ID, 490000]
export const WALLET_PROVIDER = 'web3-wallet'

export type Web3SignInRefusalReason =
  | 'nonce_expired'
  | 'chain_not_allowed'
  | 'origin_not_allowed'
  | 'not_enrolled'

/**
 * A sign-in refused after its signature verified. The caller holds the key,
 * so it may be told why, and a partner's app can tell "sign in again" apart
 * from "this address isn't enrolled".
 */
export class Web3SignInRefused extends Error {
  constructor(
    readonly reason: Web3SignInRefusalReason,
    message: string,
  ) {
    super(message)
    this.name = 'Web3SignInRefused'
  }
}

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

  // Checked first, so every refusal below is for a caller that holds the key
  // and may be told why.
  const verify = (time?: string) =>
    siweMessage.verify(
      { signature, domain: new URL(origin).host, time },
      { suppressExceptions: true },
    )
  const { success, error } = await verify()
  if (!success) {
    // An expired message that was signed by the key is the usual "sign in
    // again" case. Its expiry is the nonce's.
    if (
      error?.type === SiweErrorType.EXPIRED_MESSAGE &&
      siweMessage.issuedAt &&
      (await verify(siweMessage.issuedAt)).success &&
      address === siweMessage.address
    ) {
      throw new Web3SignInRefused('nonce_expired', 'Expired message')
    }
    throw new Error(`Invalid signature: ${error?.type}`)
  }
  if (address !== siweMessage.address) throw new Error('Address mismatch')

  const partnerOrganizationId =
    await partnerOriginsRepository.getOrganizationIdByOrigin(origin)
  if (
    !partnerOrganizationId &&
    !config.web3Auth.allowedOrigins.includes(origin)
  ) {
    throw new Web3SignInRefused(
      'origin_not_allowed',
      `Unexpected origin: ${origin}`,
    )
  }
  const allowedChainIds = partnerOrganizationId
    ? [MAINNET_CHAIN_ID]
    : EXPLORER_CHAIN_IDS
  if (!allowedChainIds.includes(siweMessage.chainId)) {
    throw new Web3SignInRefused(
      'chain_not_allowed',
      `Unexpected chain: ${siweMessage.chainId}`,
    )
  }

  const nonceExpiresAt = parseNonce(siweMessage.nonce)
  if (!nonceExpiresAt) {
    throw new Web3SignInRefused('nonce_expired', 'Unknown or expired nonce')
  }

  // A partner's origin is for its own end users, removed ones included, and
  // they sign in for nothing else.
  const membership =
    await organizationMembersRepository.getOrganizationMembershipByUser(
      WALLET_PROVIDER,
      siweMessage.address,
    )
  const endUserOf =
    membership?.role === OrganizationRole.PartnerEndUser
      ? membership.organization_id
      : null
  if (endUserOf !== partnerOrganizationId) {
    // At a partner origin every mismatch reads the same, so a partner's app
    // can't learn that someone is another partner's end user.
    throw partnerOrganizationId
      ? new Web3SignInRefused(
          'not_enrolled',
          `Not an end user of the partner of ${origin}`,
        )
      : new Web3SignInRefused(
          'origin_not_allowed',
          `Origin not allowed for this end user: ${origin}`,
        )
  }

  // Last, so a refused sign-in doesn't use up its nonce.
  const isFirstUse = await walletNoncesRepository.markNonceUsed(
    siweMessage.nonce,
    nonceExpiresAt,
  )
  if (!isFirstUse) {
    throw new Web3SignInRefused('nonce_expired', 'Nonce already used')
  }

  return {
    provider: WALLET_PROVIDER,
    id: siweMessage.address,
    username: siweMessage.address,
  }
}

export const Web3Auth = {
  createNonce,
  getUserFromAccessToken,
}
