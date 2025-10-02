import { User } from '@auto-drive/models'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('core:featureFlags')

interface FeatureFlag {
  active: boolean
  employeeOnly?: boolean
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

  return value.employeeOnly && isStaff(user)
}

const isStaff = (user: User | null) => {
  logger.debug('Checking if user is employee:', user)
  return Boolean(
    user &&
      user.oauthProvider !== 'web3-wallet' &&
      config.featureFlags.staffDomains
        .filter((domain) => domain)
        .some(
          (domain) =>
            user.oauthUsername &&
            user.oauthUsername.toLowerCase().endsWith(domain),
        ),
  )
}

export const FeatureFlagsUseCases = {
  get,
  isStaff,
}
