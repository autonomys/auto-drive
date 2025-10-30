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
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { AccountModel, UserRole } from '@auto-drive/models'
import {
  ForbiddenError,
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
    it('should error when executor is not admin', async () => {
      const executor = {
        id: 'user1',
        role: UserRole.User,
        publicId: 'pub1',
      }

      const result = await AccountsUseCases.updateAccount(
        executor as any,
        'user2',
        AccountModel.OneOff,
        1000,
        1000,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('should error when user has no organization', async () => {
      const executor = {
        id: 'admin1',
        role: UserRole.Admin,
        publicId: 'pub1',
      }

      jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue({
        organizationId: null,
      } as any)

      const result = await AccountsUseCases.updateAccount(
        executor as any,
        'user2',
        AccountModel.OneOff,
        1000,
        1000,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('should error when account not found', async () => {
      const executor = {
        id: 'admin1',
        role: UserRole.Admin,
        publicId: 'pub1',
      }

      jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue({
        organizationId: 'org123',
      } as any)

      jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(null)

      const result = await AccountsUseCases.updateAccount(
        executor as any,
        'user2',
        AccountModel.OneOff,
        1000,
        1000,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('should update account successfully', async () => {
      const executor = {
        id: 'admin1',
        role: UserRole.Admin,
        publicId: 'pub1',
      }

      jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue({
        organizationId: 'org123',
      } as any)

      const account = {
        id: 'acc123',
        organizationId: 'org123',
        model: AccountModel.OneOff,
        uploadLimit: 1000,
        downloadLimit: 1000,
      }

      jest
        .spyOn(accountsRepository, 'getByOrganizationId')
        .mockResolvedValue(account)

      const updateSpy = jest
        .spyOn(accountsRepository, 'updateAccount')
        .mockResolvedValue(account)

      const result = await AccountsUseCases.updateAccount(
        executor as any,
        'user2',
        AccountModel.Monthly,
        5000,
        5000,
      )

      expect(result.isOk()).toBe(true)
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
    it('should error when account is not OneOff model', async () => {
      jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue({
        organizationId: 'org123',
      } as any)

      const account = {
        id: 'acc123',
        organizationId: 'org123',
        model: AccountModel.Monthly,
        uploadLimit: 1000,
        downloadLimit: 1000,
      }

      jest
        .spyOn(AccountsUseCases, 'getOrCreateAccount')
        .mockResolvedValue(account as any)

      const result = await AccountsUseCases.addCreditsToAccount('pub1', 100)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('should add credits successfully', async () => {
      jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue({
        organizationId: 'org123',
      } as any)

      const account = {
        id: 'acc123',
        organizationId: 'org123',
        model: AccountModel.OneOff,
        uploadLimit: 1000,
        downloadLimit: 1000,
      }

      jest
        .spyOn(AccountsUseCases, 'getOrCreateAccount')
        .mockResolvedValue(account as any)

      const updateSpy = jest
        .spyOn(accountsRepository, 'updateAccount')
        .mockResolvedValue(account as any)

      const result = await AccountsUseCases.addCreditsToAccount('pub1', 100)

      expect(result.isOk()).toBe(true)
      expect(updateSpy).toHaveBeenCalledWith(
        'acc123',
        AccountModel.OneOff,
        1100,
        1100,
      )
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
})
