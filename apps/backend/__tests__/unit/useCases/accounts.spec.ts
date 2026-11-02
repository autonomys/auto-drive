/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { interactionsRepository } from '../../../src/infrastructure/repositories/objects/interactions.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { AccountModel, OrganizationRole, UserRole } from '@auto-drive/models'
import { err, ok } from 'neverthrow'
import {
  ForbiddenError,
  NotFoundError,
  ObjectNotFoundError,
} from '../../../src/errors/index.js'

describe('AccountsUseCases', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('updateAccount', () => {
    const admin = { role: UserRole.Admin, publicId: 'pub1' } as any

    it('should error when executor is not admin', async () => {
      const result = await AccountsUseCases.updateAccount(
        { role: UserRole.User, publicId: 'pub1' } as any,
        'acc123',
        AccountModel.OneOff,
        1000,
        1000,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('should error when account not found', async () => {
      jest.spyOn(accountsRepository, 'getById').mockResolvedValue(null)

      const result = await AccountsUseCases.updateAccount(
        admin,
        'acc123',
        AccountModel.OneOff,
        1000,
        1000,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    // By account ID: the account can be shared by several users, so no
    // single user identifies it.
    it('should update the account by its ID', async () => {
      const account = {
        id: 'acc123',
        organizationId: 'org123',
        model: AccountModel.OneOff,
        isPartner: false,
        uploadLimit: 1000,
        downloadLimit: 1000,
      }
      const lookup = jest
        .spyOn(accountsRepository, 'getById')
        .mockResolvedValue(account)
      const userLookup = jest.spyOn(AuthManager, 'getUserFromPublicId')
      const updateSpy = jest
        .spyOn(accountsRepository, 'updateAccount')
        .mockResolvedValue(account)

      const result = await AccountsUseCases.updateAccount(
        admin,
        'acc123',
        AccountModel.Monthly,
        5000,
        5000,
      )

      expect(result.isOk()).toBe(true)
      expect(lookup).toHaveBeenCalledWith('acc123')
      expect(userLookup).not.toHaveBeenCalled()
      expect(updateSpy).toHaveBeenCalledWith(
        'acc123',
        AccountModel.Monthly,
        5000,
        5000,
      )
    })
  })

  describe('getOrCreateAccount', () => {
    it('should throw error when organization ID is missing', async () => {
      const user = {
        id: 'user1',
        organizationId: null,
        oauthProvider: 'google',
      }

      await expect(
        AccountsUseCases.getOrCreateAccount(user as any),
      ).rejects.toThrow('User organization ID is required')
    })

    it('should return existing account', async () => {
      const user = {
        id: 'user1',
        organizationId: 'org123',
        oauthProvider: 'google',
      }

      const account = {
        id: 'acc123',
        organizationId: 'org123',
        model: AccountModel.OneOff,
        isPartner: false,
      }

      jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(account as any)

      const result = await AccountsUseCases.getOrCreateAccount(user as any)

      expect(result).toEqual(account)
    })

    it('should create web3 account when not exists', async () => {
      const user = {
        id: 'user1',
        organizationId: 'org123',
        oauthProvider: 'web3-wallet',
      }

      jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(null)

      const newAccount = {
        id: 'acc123',
        organizationId: 'org123',
        model: AccountModel.OneOff,
        isPartner: false,
      }

      const initSpy = jest
        .spyOn(AccountsUseCases, 'initAccount')
        .mockResolvedValue(newAccount as any)

      const result = await AccountsUseCases.getOrCreateAccount(user as any)

      expect(initSpy).toHaveBeenCalled()
      expect(result).toEqual(newAccount)
    })

    it('should create default account for non-web3 users', async () => {
      const user = {
        id: 'user1',
        organizationId: 'org123',
        oauthProvider: 'github',
      }

      jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(null)

      const newAccount = {
        id: 'acc123',
        organizationId: 'org123',
        model: AccountModel.OneOff,
        isPartner: false,
      }

      const initSpy = jest
        .spyOn(AccountsUseCases, 'initAccount')
        .mockResolvedValue(newAccount as any)

      const result = await AccountsUseCases.getOrCreateAccount(user as any)

      expect(initSpy).toHaveBeenCalled()
      expect(result).toEqual(newAccount)
    })
  })

  describe('addCreditsToAccount', () => {
    const account = {
      id: 'acc123',
      organizationId: 'org123',
      model: AccountModel.OneOff,
      isPartner: false,
      uploadLimit: 1000,
      downloadLimit: 1000,
    }

    beforeEach(() => {
      jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue({
        organizationId: 'org123',
      } as any)
      jest
        .spyOn(AccountsUseCases, 'getOrCreateAccount')
        .mockResolvedValue(account as any)
    })

    it('should create a purchased_credits row on success', async () => {
      const { ok: neverthrowOk } = await import('neverthrow')

      const createSpy = jest
        .spyOn(purchasedCreditsRepository, 'createPurchasedCreditWithCapCheck')
        .mockResolvedValue(neverthrowOk({} as any))

      // Install spy BEFORE the call so it intercepts any invocation
      const updateSpy = jest
        .spyOn(accountsRepository, 'updateAccount')
        .mockResolvedValue(undefined as any)

      const result = await AccountsUseCases.addCreditsToAccount(
        { id: 'intent-xyz', userPublicId: 'pub1' },
        BigInt(500),
      )

      expect(result.isOk()).toBe(true)
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc123',
          intentId: 'intent-xyz',
          uploadBytesOriginal: BigInt(500),
          // Download credits are not allocated on purchase
          downloadBytesOriginal: 0n,
        }),
        expect.anything(),
      )
      // accounts table must NOT be touched — credit goes to purchased_credits
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it('should reject when purchase would exceed per-account cap', async () => {
      const { err: neverthrowErr } = await import('neverthrow')

      jest
        .spyOn(purchasedCreditsRepository, 'createPurchasedCreditWithCapCheck')
        .mockResolvedValue(neverthrowErr('cap_exceeded' as const))

      const result = await AccountsUseCases.addCreditsToAccount(
        { id: 'intent-over-cap', userPublicId: 'pub1' },
        BigInt(1),
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('should work for any account model (not restricted to OneOff)', async () => {
      const { ok: neverthrowOk } = await import('neverthrow')
      const monthlyAccount = { ...account, model: AccountModel.Monthly }
      jest
        .spyOn(AccountsUseCases, 'getOrCreateAccount')
        .mockResolvedValue(monthlyAccount as any)
      jest
        .spyOn(purchasedCreditsRepository, 'createPurchasedCreditWithCapCheck')
        .mockResolvedValue(neverthrowOk({} as any))

      const result = await AccountsUseCases.addCreditsToAccount(
        { id: 'intent-monthly', userPublicId: 'pub1' },
        BigInt(100),
      )

      expect(result.isOk()).toBe(true)
    })

    // The buyer may have moved to another organization since creating the
    // intent; the credits still go to the account it was created for.
    it('should credit the account of the intent, not the current one of the buyer', async () => {
      const { ok: neverthrowOk } = await import('neverthrow')
      const createSpy = jest
        .spyOn(purchasedCreditsRepository, 'createPurchasedCreditWithCapCheck')
        .mockResolvedValue(neverthrowOk({} as any))

      const result = await AccountsUseCases.addCreditsToAccount(
        { id: 'intent-1', userPublicId: 'pub1', accountId: 'acc-at-creation' },
        BigInt(100),
      )

      expect(result.isOk()).toBe(true)
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'acc-at-creation' }),
        expect.anything(),
      )
      expect(AuthManager.getUserFromPublicId).not.toHaveBeenCalled()
      expect(AccountsUseCases.getOrCreateAccount).not.toHaveBeenCalled()
    })
  })

  describe('getAccountById', () => {
    it('should return account when found', async () => {
      const account = {
        id: 'acc123',
        organizationId: 'org123',
      }

      jest
        .spyOn(accountsRepository, 'getById')
        .mockResolvedValue(account as any)

      const result = await AccountsUseCases.getAccountById('acc123')

      expect(result).toEqual(account)
    })

    it('should return null when account not found', async () => {
      jest.spyOn(accountsRepository, 'getById').mockResolvedValue(null)

      const result = await AccountsUseCases.getAccountById('notfound')

      expect(result).toBeNull()
    })
  })
  describe('adminSearchAccounts', () => {
    const admin = { role: UserRole.Admin, publicId: 'admin' } as any

    it('should reject non-admin executors', async () => {
      const result = await AccountsUseCases.adminSearchAccounts(
        { role: UserRole.User, publicId: 'pub1' } as any,
        'abc',
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('should resolve an account ID to its organization members', async () => {
      const account = {
        id: 'acc123',
        organizationId: 'org123',
        uploadLimit: 10,
        downloadLimit: 10,
        model: AccountModel.OneOff,
        isPartner: false,
      }
      const member = {
        publicId: 'pub1',
        organizationId: 'org123',
        role: UserRole.User,
      }
      jest.spyOn(accountsRepository, 'getById').mockResolvedValue(account)
      const search = jest
        .spyOn(AuthManager, 'adminSearchUsers')
        .mockResolvedValue([member as any])
      jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(account)
      jest
        .spyOn(
          interactionsRepository,
          'getInteractionsByAccountIdAndTypeInTimeRange',
        )
        .mockResolvedValue([])
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({ uploadBytesRemaining: BigInt(5) } as any)

      const result = await AccountsUseCases.adminSearchAccounts(admin, 'acc123')

      expect(search).toHaveBeenCalledWith('acc123', 'org123')
      const [found] = result._unsafeUnwrap()
      expect(found.id).toBe('acc123')
      expect(found.user.publicId).toBe('pub1')
      expect(found.pendingUploadCredits).toBe(15)
      expect(found.pendingDownloadCredits).toBe(10)
    })

    it('should look up a shared account once for all its members', async () => {
      const account = {
        id: 'acc-shared',
        organizationId: 'org-shared',
        uploadLimit: 10,
        downloadLimit: 10,
        model: AccountModel.OneOff,
        isPartner: false,
      }
      jest.spyOn(accountsRepository, 'getById').mockResolvedValue(account)
      jest.spyOn(AuthManager, 'adminSearchUsers').mockResolvedValue([
        { publicId: 'pub1', organizationId: 'org-shared' },
        { publicId: 'pub2', organizationId: 'org-shared' },
      ] as any)
      const lookup = jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(account)
      jest
        .spyOn(
          interactionsRepository,
          'getInteractionsByAccountIdAndTypeInTimeRange',
        )
        .mockResolvedValue([])
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({ uploadBytesRemaining: BigInt(0) } as any)

      const result = await AccountsUseCases.adminSearchAccounts(
        admin,
        'acc-shared',
      )

      expect(lookup).toHaveBeenCalledTimes(1)
      expect(
        result._unsafeUnwrap().map((r) => [r.id, r.user.publicId]),
      ).toEqual([
        ['acc-shared', 'pub1'],
        ['acc-shared', 'pub2'],
      ])
    })

    it('should pass the query through as an organization ID otherwise', async () => {
      jest.spyOn(accountsRepository, 'getById').mockResolvedValue(null)
      const search = jest
        .spyOn(AuthManager, 'adminSearchUsers')
        .mockResolvedValue([
          { publicId: 'pending', organizationId: null } as any,
        ])

      const result = await AccountsUseCases.adminSearchAccounts(admin, 'org9')

      expect(search).toHaveBeenCalledWith('org9', 'org9')
      expect(result._unsafeUnwrap()).toEqual([])
    })
  })
  describe('adminGetAccount', () => {
    const admin = { role: UserRole.Admin, publicId: 'admin' } as any
    const account = {
      id: 'acc1',
      organizationId: 'org1',
      uploadLimit: 10,
      downloadLimit: 10,
      model: AccountModel.OneOff,
      isPartner: false,
    }

    beforeEach(() => {
      jest
        .spyOn(
          interactionsRepository,
          'getInteractionsByAccountIdAndTypeInTimeRange',
        )
        .mockResolvedValue([])
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({ uploadBytesRemaining: BigInt(5) } as any)
      jest
        .spyOn(AuthManager, 'getOrganization')
        .mockResolvedValue(err(new NotFoundError('Organization not found')))
    })

    it('should reject non-admin executors', async () => {
      const result = await AccountsUseCases.adminGetAccount(
        { role: UserRole.User, publicId: 'pub1' } as any,
        'acc1',
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('should return an account with no members', async () => {
      jest.spyOn(accountsRepository, 'getById').mockResolvedValue(account)
      const search = jest
        .spyOn(AuthManager, 'adminSearchUsers')
        .mockResolvedValue([])

      const result = await AccountsUseCases.adminGetAccount(admin, 'acc1')

      expect(search).toHaveBeenCalledWith('', 'org1')
      expect(result._unsafeUnwrap()).toEqual({
        ...account,
        pendingUploadCredits: 15,
        pendingDownloadCredits: 10,
        members: [],
        organization: null,
      })
    })

    it('should include the organization with its member roles', async () => {
      jest.spyOn(accountsRepository, 'getById').mockResolvedValue(account)
      jest.spyOn(AuthManager, 'adminSearchUsers').mockResolvedValue([])
      const organization = {
        id: 'org1',
        name: 'Partner',
        archivedAt: null,
        members: [{ publicId: 'pub1', role: OrganizationRole.Admin }],
      }
      jest
        .spyOn(AuthManager, 'getOrganization')
        .mockResolvedValue(ok(organization))

      const result = await AccountsUseCases.adminGetAccount(admin, 'acc1')

      expect(result._unsafeUnwrap().organization).toEqual(organization)
    })

    it('should not treat an organization ID as an account ID', async () => {
      jest.spyOn(accountsRepository, 'getById').mockResolvedValue(null)
      const byOrganization = jest.spyOn(
        accountsRepository,
        'getByOrganizationId',
      )

      const result = await AccountsUseCases.adminGetAccount(admin, 'org1')

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
      expect(byOrganization).not.toHaveBeenCalled()
    })
  })

  describe('adminGetAccountByOrganization', () => {
    const admin = { role: UserRole.Admin, publicId: 'admin' } as any
    const account = {
      id: 'acc1',
      organizationId: 'org1',
      uploadLimit: 10,
      downloadLimit: 10,
      model: AccountModel.OneOff,
      isPartner: false,
    }

    beforeEach(() => {
      jest
        .spyOn(
          interactionsRepository,
          'getInteractionsByAccountIdAndTypeInTimeRange',
        )
        .mockResolvedValue([])
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({ uploadBytesRemaining: BigInt(5) } as any)
      jest
        .spyOn(AuthManager, 'getOrganization')
        .mockResolvedValue(err(new NotFoundError('Organization not found')))
    })

    it('should reject non-admin executors', async () => {
      const result = await AccountsUseCases.adminGetAccountByOrganization(
        { role: UserRole.User, publicId: 'pub1' } as any,
        'org1',
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('should return the account of the organization and list its members', async () => {
      const lookup = jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(account)
      const search = jest
        .spyOn(AuthManager, 'adminSearchUsers')
        .mockResolvedValue([
          { publicId: 'pub1', organizationId: 'org1' },
          { publicId: 'pending', organizationId: null },
        ] as any)

      const result = await AccountsUseCases.adminGetAccountByOrganization(
        admin,
        'org1',
      )

      expect(lookup).toHaveBeenCalledWith('org1')
      expect(search).toHaveBeenCalledWith('', 'org1')
      expect(result._unsafeUnwrap().members.map((m) => m.publicId)).toEqual([
        'pub1',
      ])
    })

    it('should return not found for an unknown organization', async () => {
      jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(null)

      const result = await AccountsUseCases.adminGetAccountByOrganization(
        admin,
        'nope',
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })
  })

  describe('adminGetAccountIdsByUsers', () => {
    const admin = { role: UserRole.Admin, publicId: 'admin' } as any

    it('should reject non-admin executors', async () => {
      const result = await AccountsUseCases.adminGetAccountIdsByUsers(
        { role: UserRole.User, publicId: 'pub1' } as any,
        ['pub1'],
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('should map users to existing accounts without creating any', async () => {
      jest.spyOn(AuthManager, 'getUsersFromPublicIds').mockResolvedValue([
        { publicId: 'pub1', organizationId: 'org1' },
        { publicId: 'pub2', organizationId: 'org2' },
        { publicId: 'gone', organizationId: null },
      ] as any)
      jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockImplementation(async (orgId) =>
          orgId === 'org1'
            ? {
                id: 'acc1',
                organizationId: 'org1',
                uploadLimit: 10,
                downloadLimit: 10,
                model: AccountModel.OneOff,
                isPartner: false,
              }
            : null,
        )
      const create = jest.spyOn(accountsRepository, 'createAccount')

      const result = await AccountsUseCases.adminGetAccountIdsByUsers(admin, [
        'pub1',
        'pub2',
        'gone',
      ])

      expect(result._unsafeUnwrap()).toEqual({ pub1: 'acc1' })
      expect(create).not.toHaveBeenCalled()
    })
  })

  describe('getUserListAccount', () => {
    const admin = { role: UserRole.Admin, publicId: 'admin' } as any

    it('should reject non-admin executors before any lookup', async () => {
      const lookup = jest
        .spyOn(AuthManager, 'getUsersFromPublicIds')
        .mockResolvedValue([])

      const result = await AccountsUseCases.getUserListAccount(
        { role: UserRole.User, publicId: 'pub1' } as any,
        ['pub2'],
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
      expect(lookup).not.toHaveBeenCalled()
    })

    it('should return account info keyed by publicId for known users', async () => {
      jest
        .spyOn(AuthManager, 'getUsersFromPublicIds')
        .mockResolvedValue([
          { publicId: 'pub1', organizationId: 'org1' },
        ] as any)
      jest.spyOn(accountsRepository, 'getByOrganizationId').mockResolvedValue({
        id: 'acc1',
        organizationId: 'org1',
        uploadLimit: 100,
        downloadLimit: 50,
        model: AccountModel.OneOff,
        isPartner: false,
      })
      jest
        .spyOn(
          interactionsRepository,
          'getInteractionsByAccountIdAndTypeInTimeRange',
        )
        .mockResolvedValue([])
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({ uploadBytesRemaining: 0n } as any)

      const result = await AccountsUseCases.getUserListAccount(admin, [
        'pub1',
        'unknown',
      ])

      expect(result._unsafeUnwrap()).toEqual({
        pub1: {
          id: 'acc1',
          organizationId: 'org1',
          uploadLimit: 100,
          downloadLimit: 50,
          model: AccountModel.OneOff,
          isPartner: false,
          pendingUploadCredits: 100,
          pendingDownloadCredits: 50,
        },
      })
    })

    it('should look up a shared account once for all its members', async () => {
      const account = {
        id: 'acc1',
        organizationId: 'org1',
        uploadLimit: 100,
        downloadLimit: 50,
        model: AccountModel.OneOff,
        isPartner: false,
      }
      jest.spyOn(AuthManager, 'getUsersFromPublicIds').mockResolvedValue([
        { publicId: 'pub1', organizationId: 'org1' },
        { publicId: 'pub2', organizationId: 'org1' },
        { publicId: 'pending', organizationId: null },
      ] as any)
      const lookup = jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(account)
      jest
        .spyOn(
          interactionsRepository,
          'getInteractionsByAccountIdAndTypeInTimeRange',
        )
        .mockResolvedValue([])
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({ uploadBytesRemaining: 0n } as any)

      const result = await AccountsUseCases.getUserListAccount(admin, [
        'pub1',
        'pub2',
        'pending',
      ])

      const accounts = result._unsafeUnwrap()
      expect(lookup).toHaveBeenCalledTimes(1)
      expect(Object.keys(accounts)).toEqual(['pub1', 'pub2'])
      expect(accounts.pub1.id).toBe('acc1')
      expect(accounts.pub2.id).toBe('acc1')
    })
  })
})
