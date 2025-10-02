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

const isActive = (value: FeatureFlag, user: User | null) => {
  if (value.active) {
    return true
  }

  return value.staffOnly && isStaff(user)
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
        (username) => username === user.oauthUsername,
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
}
