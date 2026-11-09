import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { err, ok } from 'neverthrow'
import {
  Account,
  AccountModel,
  Intent,
  IntentStatus,
  OrganizationRole,
  PurchasedCreditSummary,
  User,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { OrganizationsUseCases } from '../../../src/core/users/organizations.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { intentsRepository } from '../../../src/infrastructure/repositories/users/intents.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../src/errors/index.js'

const admin = { role: UserRole.Admin, publicId: 'admin-pub' } as User

const accountFor = (organizationId: string, isPartner: boolean): Account => ({
  id: `acc-${organizationId}`,
  organizationId,
  model: AccountModel.OneOff,
  uploadLimit: 0,
  downloadLimit: 0,
  isPartner,
  maxPurchasedBytes: null,
  creditExpiryDays: null,
})

const remaining = (uploadBytesRemaining: bigint) =>
  ({
    uploadBytesRemaining,
    uploadBytesOriginal: uploadBytesRemaining,
    downloadBytesRemaining: 0n,
    nextExpiryDate: null,
    activeRowCount: uploadBytesRemaining > 0n ? 1 : 0,
  }) as PurchasedCreditSummary

describe('OrganizationsUseCases', () => {
  let addMemberSpy: jest.SpiedFunction<typeof AuthManager.addOrganizationMember>

  beforeEach(() => {
    // partner-org is a partner account; anything else is a personal one.
    jest
      .spyOn(accountsRepository, 'getByOrganizationId')
      .mockImplementation(async (organizationId) =>
        accountFor(organizationId, organizationId.startsWith('partner')),
      )
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue({
      publicId: 'pub1',
      organizationId: 'personal-org',
    } as UserWithOrganization)
    jest
      .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
      .mockResolvedValue(remaining(0n))
    jest.spyOn(intentsRepository, 'getByUserAndStatuses').mockResolvedValue([])
    addMemberSpy = jest
      .spyOn(AuthManager, 'addOrganizationMember')
      .mockResolvedValue(ok(undefined))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('rejects non-admin executors', async () => {
    const user = { role: UserRole.User, publicId: 'pub1' } as User

    const results = await Promise.all([
      OrganizationsUseCases.createPartnerOrganization(user, 'Partner'),
      OrganizationsUseCases.listPartnerOrganizations(user),
      OrganizationsUseCases.addMember(
        user,
        'partner-org',
        'pub2',
        OrganizationRole.Member,
      ),
      OrganizationsUseCases.changeMemberRole(
        user,
        'partner-org',
        'pub2',
        OrganizationRole.Admin,
      ),
      OrganizationsUseCases.removeMember(user, 'partner-org', 'pub2'),
      OrganizationsUseCases.getMembershipChanges(user, 'partner-org'),
    ])

    for (const result of results) {
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    }
    expect(addMemberSpy).not.toHaveBeenCalled()
  })

  it('creates the partner account with the organization', async () => {
    jest
      .spyOn(AuthManager, 'createOrganization')
      .mockResolvedValue(ok({ id: 'partner-new', name: 'Partner' }))
    const create = jest
      .spyOn(accountsRepository, 'createAccount')
      .mockImplementation(async (id, organizationId) => ({
        ...accountFor(organizationId, true),
        id,
      }))

    const result = await OrganizationsUseCases.createPartnerOrganization(
      admin,
      'Partner',
    )

    const created = result._unsafeUnwrap()
    expect(create).toHaveBeenCalledWith(
      created.accountId,
      'partner-new',
      AccountModel.Monthly,
      0,
      expect.any(Number),
      'admin-pub',
    )
    expect(created).toMatchObject({
      id: 'partner-new',
      name: 'Partner',
      memberCount: 0,
    })
  })

  it('lists partner organizations with their accounts', async () => {
    jest
      .spyOn(accountsRepository, 'getPartnerAccounts')
      .mockResolvedValue([accountFor('partner-a', true)])
    jest.spyOn(AuthManager, 'getOrganizationSummaries').mockResolvedValue(
      ok([
        { id: 'partner-a', name: 'A', archivedAt: null, memberCount: 2 },
      ]),
    )

    const result = await OrganizationsUseCases.listPartnerOrganizations(admin)

    expect(result._unsafeUnwrap()).toEqual([
      {
        id: 'partner-a',
        name: 'A',
        archivedAt: null,
        memberCount: 2,
        accountId: 'acc-partner-a',
      },
    ])
  })

  describe('addMember', () => {
    it('moves the user and records the acting admin', async () => {
      const result = await OrganizationsUseCases.addMember(
        admin,
        'partner-org',
        'pub1',
        OrganizationRole.Member,
      )

      expect(result.isOk()).toBe(true)
      expect(addMemberSpy).toHaveBeenCalledWith(
        'partner-org',
        { publicId: 'pub1', role: OrganizationRole.Member },
        'admin-pub',
      )
    })

    it('only moves users into partner organizations', async () => {
      const result = await OrganizationsUseCases.addMember(
        admin,
        'personal-other',
        'pub1',
        OrganizationRole.Member,
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
      expect(addMemberSpy).not.toHaveBeenCalled()
    })

    it('refuses a user from another partner organization', async () => {
      jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue({
        publicId: 'pub1',
        organizationId: 'partner-other',
      } as UserWithOrganization)

      const result = await OrganizationsUseCases.addMember(
        admin,
        'partner-org',
        'pub1',
        OrganizationRole.Member,
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
      expect(addMemberSpy).not.toHaveBeenCalled()
    })

    it('refuses a user whose account holds purchased credits', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue(remaining(1024n))

      const result = await OrganizationsUseCases.addMember(
        admin,
        'partner-org',
        'pub1',
        OrganizationRole.Member,
      )

      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(ConflictError)
      expect(error.message).toContain('1024 bytes of purchased credits')
      expect(addMemberSpy).not.toHaveBeenCalled()
    })

    it('refuses a user with unresolved payments', async () => {
      const lookup = jest
        .spyOn(intentsRepository, 'getByUserAndStatuses')
        .mockResolvedValue([
          { id: 'i1', status: IntentStatus.OVER_CAP } as Intent,
        ])

      const result = await OrganizationsUseCases.addMember(
        admin,
        'partner-org',
        'pub1',
        OrganizationRole.Member,
      )

      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(ConflictError)
      expect(error.message).toContain('over_cap')
      expect(lookup).toHaveBeenCalledWith('pub1', [
        IntentStatus.PENDING,
        IntentStatus.CONFIRMED,
        IntentStatus.OVER_CAP,
      ])
      expect(addMemberSpy).not.toHaveBeenCalled()
    })

    it('reports an unknown user as not found', async () => {
      jest
        .spyOn(AuthManager, 'getUserFromPublicId')
        .mockRejectedValue(new Error('Failed to get user'))

      const result = await OrganizationsUseCases.addMember(
        admin,
        'partner-org',
        'nobody',
        OrganizationRole.Member,
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    })

    it('passes on a refusal from the auth service', async () => {
      addMemberSpy.mockResolvedValue(
        err(new ConflictError('Organization is archived')),
      )

      const result = await OrganizationsUseCases.addMember(
        admin,
        'partner-org',
        'pub1',
        OrganizationRole.Member,
      )

      expect(result._unsafeUnwrapErr().message).toBe('Organization is archived')
    })
  })

  describe('removeMember', () => {
    it('refuses a user with unresolved payments', async () => {
      jest
        .spyOn(intentsRepository, 'getByUserAndStatuses')
        .mockResolvedValue([{ id: 'i1', status: IntentStatus.PENDING } as Intent])
      const remove = jest.spyOn(AuthManager, 'removeOrganizationMember')

      const result = await OrganizationsUseCases.removeMember(
        admin,
        'partner-org',
        'pub1',
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
      expect(remove).not.toHaveBeenCalled()
    })

    it('returns the organization the user was restored to', async () => {
      const remove = jest
        .spyOn(AuthManager, 'removeOrganizationMember')
        .mockResolvedValue(ok({ organizationId: 'personal-org' }))

      const result = await OrganizationsUseCases.removeMember(
        admin,
        'partner-org',
        'pub1',
      )

      expect(result._unsafeUnwrap()).toEqual({ organizationId: 'personal-org' })
      expect(remove).toHaveBeenCalledWith('partner-org', 'pub1', 'admin-pub')
    })
  })
})
