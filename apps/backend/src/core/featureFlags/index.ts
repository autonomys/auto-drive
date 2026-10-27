import { User, UserRole } from '@auto-drive/models'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('core:featureFlags')

export interface FeatureFlag {
  active: boolean
  staffOnly?: boolean
}

export type FeatureFlagKey = keyof typeof config.featureFlags.flags

const get = (user: User | null) => {
  const entries = Object.entries(config.featureFlags.flags)

  return Object.fromEntries(
    entries.map(([key, value]) => [key, isActive(key, value, user)]),
  )
}

// One flag's state for one user, without materialising the whole map.
//
// Exists so a use case can gate on the same rules the client is told about via
// `get`. Two evaluations of the same flag that could disagree is the failure
// this avoids: the UI would offer a path the backend then refuses.
const isFlagActive = (key: FeatureFlagKey, user: User | null): boolean => {
  return isActive(key, config.featureFlags.flags[key], user)
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

// An account with the Admin role. Distinct from `isStaff`, which is a
// configured allowlist of domains and usernames: staff is who we recognise,
// admin is who we have granted authority to.
export const isAdmin = (user: User | null): boolean => {
  return Boolean(user && user.role === UserRole.Admin)
}

const isActive = (key: string, value: FeatureFlag, user: User | null) => {
  // buyCredits requires Google auth when publicly active.
  if (key === 'buyCredits' && value.active) {
    return hasGoogleAuth(user)
  }

  // payWithUsdc stays open to admins whatever the flag says. The USDC path has
  // to be driven end to end against production — a real quote, a real transfer,
  // a real settlement — before it can be opened to users with any confidence,
  // and a switch that also locks out the people verifying it cannot be turned on
  // on the strength of anything but hope.
  //
  // Placed before the `value.active` short-circuit so it reads as one rule
  // ("admins always") rather than as a special case of the flag being off.
  if (key === 'payWithUsdc' && isAdmin(user)) {
    return true
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
  isFlagActive,
  isStaff,
  isAdmin,
  hasGoogleAuth,
}
