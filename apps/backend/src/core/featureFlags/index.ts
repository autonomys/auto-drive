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
    entries.map(([key, value]) => [key, isActive(key, value, user)]),
  )
}

// Returns true if the user's account was registered via Google OAuth.
// Used as the purchase gate when buyCredits is publicly active.
//
// This checks the user's *registration* provider (oauthProvider), not the
// current auth method.  When a request uses an API key, the auth service
// resolves the key to its owner and returns the owner's original oauthProvider.
// This means an API key from a Google-registered account satisfies this check,
// enabling third-party apps to create intents server-side.
export const hasGoogleAuth = (user: User | null): boolean => {
  return Boolean(user && user.oauthProvider === 'google')
}

const isActive = (key: string, value: FeatureFlag, user: User | null) => {
  // buyCredits requires Google auth when publicly active.
  if (key === 'buyCredits' && value.active) {
    return hasGoogleAuth(user)
  }

  if (value.active) {
    return true
  }

  // Staff-only mode: access is granted via STAFF_DOMAINS /
  // STAFF_USERNAME_ALLOWLIST config. Works for any flag.
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
