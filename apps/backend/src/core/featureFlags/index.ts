import { User } from '@auto-drive/models'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('core:featureFlags')

export interface FeatureFlag {
  active: boolean
  staffOnly?: boolean
}

const get = (user: User | null) => {
  const entries = Object.entries(config.featureFlags.flags)

  return Object.fromEntries(
    entries.map(([key, value]) => [key, isActive(value, user)]),
  )
}

// Returns true if the user authenticated via Google OAuth.
// Used as the purchase gate when the feature is publicly active.
export const hasGoogleAuth = (user: User | null): boolean => {
  return Boolean(user && user.oauthProvider === 'google')
}

const isActive = (value: FeatureFlag, user: User | null) => {
  // Public mode (BUY_CREDITS_ACTIVE=true): only users authenticated via Google
  // can access the feature.  This prevents Sybil purchases — Google accounts
  // require phone verification and are much harder to mass-create than web3
  // wallets or pseudonymous OAuth accounts.
  if (value.active) {
    return hasGoogleAuth(user)
  }

  // Staff-only mode (BUY_CREDITS_ACTIVE=false, BUY_CREDITS_STAFF_ONLY=true):
  // access is granted via the STAFF_DOMAINS / STAFF_USERNAME_ALLOWLIST config,
  // which in production is set to @subspace.network and @autonomys.xyz.
  return Boolean(value.staffOnly && isStaff(user))
}

const isStaffDomain = (user: User | null) => {
  return Boolean(
    user &&
      user.oauthProvider !== 'web3-wallet' &&
      config.featureFlags.staffDomains.some(
        (domain) =>
          user.oauthUsername &&
          user.oauthUsername.toLowerCase().endsWith(`@${domain}`),
      ),
  )
}

const isStaffUsername = (user: User | null) => {
  return Boolean(
    user &&
      user.oauthProvider !== 'web3-wallet' &&
      config.featureFlags.allowlistedUsernames.some(
        (username) => username === user.oauthUsername?.toLowerCase(),
      ),
  )
}

const isStaff = (user: User | null) => {
  logger.debug('Checking if user is employee:', user)
  return Boolean(user && (isStaffDomain(user) || isStaffUsername(user)))
}

export const FeatureFlagsUseCases = {
  get,
  isStaff,
  hasGoogleAuth,
}
