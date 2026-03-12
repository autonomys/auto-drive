import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { FeatureFlagsUseCases, hasGoogleAuth } from '../../../src/core/featureFlags/index.js'
import { config } from '../../../src/config.js'
import type { User } from '@auto-drive/models'

// Minimal User factory — only fields relevant to feature flag checks.
const makeUser = (
  overrides: Partial<Pick<User, 'oauthProvider' | 'oauthUsername'>> = {},
): User =>
  ({
    id: 'u1',
    publicId: 'pub-1',
    oauthProvider: 'google',
    oauthUsername: 'user@example.com',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as unknown as User

describe('hasGoogleAuth', () => {
  it('returns true for google provider', () => {
    expect(hasGoogleAuth(makeUser({ oauthProvider: 'google' }))).toBe(true)
  })

  it('returns false for github provider', () => {
    expect(hasGoogleAuth(makeUser({ oauthProvider: 'github' }))).toBe(false)
  })

  it('returns false for discord provider', () => {
    expect(hasGoogleAuth(makeUser({ oauthProvider: 'discord' }))).toBe(false)
  })

  it('returns false for web3-wallet provider', () => {
    expect(hasGoogleAuth(makeUser({ oauthProvider: 'web3-wallet' }))).toBe(false)
  })

  it('returns false for null user', () => {
    expect(hasGoogleAuth(null)).toBe(false)
  })
})

describe('FeatureFlagsUseCases.get — buyCredits gating', () => {
  const originalFlags = config.featureFlags.flags
  const originalDomains = config.featureFlags.staffDomains
  const originalAllowlist = config.featureFlags.allowlistedUsernames

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    // Restore config after each test
    config.featureFlags.flags = originalFlags
    config.featureFlags.staffDomains = originalDomains
    config.featureFlags.allowlistedUsernames = originalAllowlist
  })

  // ── active=true (public mode) ─────────────────────────────────────────────

  it('active=true: returns true for Google user', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: true, staffOnly: false },
    }
    const user = makeUser({ oauthProvider: 'google' })
    expect(FeatureFlagsUseCases.get(user).buyCredits).toBe(true)
  })

  it('active=true: returns false for GitHub user', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: true, staffOnly: false },
    }
    const user = makeUser({ oauthProvider: 'github', oauthUsername: 'user@subspace.network' })
    expect(FeatureFlagsUseCases.get(user).buyCredits).toBe(false)
  })

  it('active=true: returns false for web3-wallet user', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: true, staffOnly: false },
    }
    const user = makeUser({ oauthProvider: 'web3-wallet', oauthUsername: undefined })
    expect(FeatureFlagsUseCases.get(user).buyCredits).toBe(false)
  })

  it('active=true: returns false for unauthenticated (null) user', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: true, staffOnly: false },
    }
    expect(FeatureFlagsUseCases.get(null).buyCredits).toBe(false)
  })

  it('active=true: staff domain user without Google auth is still blocked', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: true, staffOnly: true },
    }
    config.featureFlags.staffDomains = ['subspace.network']
    // GitHub user with a subspace.network email — not Google auth
    const user = makeUser({
      oauthProvider: 'github',
      oauthUsername: 'dev@subspace.network',
    })
    expect(FeatureFlagsUseCases.get(user).buyCredits).toBe(false)
  })

  // ── active=false, staffOnly=true (staff mode) ─────────────────────────────

  it('staffOnly=true: returns true for staff domain user', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: false, staffOnly: true },
    }
    config.featureFlags.staffDomains = ['subspace.network']
    const user = makeUser({
      oauthProvider: 'github',
      oauthUsername: 'dev@subspace.network',
    })
    expect(FeatureFlagsUseCases.get(user).buyCredits).toBe(true)
  })

  it('staffOnly=true: returns true for allowlisted username', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: false, staffOnly: true },
    }
    config.featureFlags.allowlistedUsernames = ['testuser@example.com']
    const user = makeUser({
      oauthProvider: 'github',
      oauthUsername: 'testuser@example.com',
    })
    expect(FeatureFlagsUseCases.get(user).buyCredits).toBe(true)
  })

  it('staffOnly=true: returns false for non-staff user', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: false, staffOnly: true },
    }
    config.featureFlags.staffDomains = ['subspace.network']
    const user = makeUser({
      oauthProvider: 'google',
      oauthUsername: 'random@gmail.com',
    })
    expect(FeatureFlagsUseCases.get(user).buyCredits).toBe(false)
  })

  it('staffOnly=true: returns false for web3-wallet even with matching domain', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: false, staffOnly: true },
    }
    config.featureFlags.staffDomains = ['subspace.network']
    const user = makeUser({
      oauthProvider: 'web3-wallet',
      oauthUsername: 'dev@subspace.network',
    })
    expect(FeatureFlagsUseCases.get(user).buyCredits).toBe(false)
  })

  // ── fully disabled ────────────────────────────────────────────────────────

  it('active=false, staffOnly=false: returns false for everyone', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      buyCredits: { active: false, staffOnly: false },
    }
    expect(FeatureFlagsUseCases.get(makeUser({ oauthProvider: 'google' })).buyCredits).toBe(false)
    expect(FeatureFlagsUseCases.get(makeUser({ oauthProvider: 'github' })).buyCredits).toBe(false)
    expect(FeatureFlagsUseCases.get(null).buyCredits).toBe(false)
  })
})

describe('FeatureFlagsUseCases.get — non-buyCredits flags', () => {
  const originalFlags = config.featureFlags.flags

  afterEach(() => {
    config.featureFlags.flags = originalFlags
  })

  it('taskManager active=true returns true regardless of user auth', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      taskManager: { active: true },
    }
    expect(FeatureFlagsUseCases.get(null).taskManager).toBe(true)
    expect(FeatureFlagsUseCases.get(makeUser({ oauthProvider: 'github' })).taskManager).toBe(true)
    expect(FeatureFlagsUseCases.get(makeUser({ oauthProvider: 'web3-wallet' })).taskManager).toBe(true)
  })

  it('taskManager active=false returns false', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      taskManager: { active: false },
    }
    expect(FeatureFlagsUseCases.get(makeUser({ oauthProvider: 'google' })).taskManager).toBe(false)
  })

  it('objectMappingArchiver active=true returns true regardless of user auth', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      objectMappingArchiver: { active: true },
    }
    expect(FeatureFlagsUseCases.get(null).objectMappingArchiver).toBe(true)
    expect(FeatureFlagsUseCases.get(makeUser({ oauthProvider: 'web3-wallet' })).objectMappingArchiver).toBe(true)
  })

  it('objectMappingArchiver active=false returns false', () => {
    config.featureFlags.flags = {
      ...originalFlags,
      objectMappingArchiver: { active: false },
    }
    expect(FeatureFlagsUseCases.get(makeUser({ oauthProvider: 'google' })).objectMappingArchiver).toBe(false)
  })
})
