import {
  AccountModel,
  IntentStatus,
  InteractionType,
  User,
  UserRole,
} from '@auto-drive/models'
import { jest } from '@jest/globals'
import { ok } from 'neverthrow'
import { v4 as uuidv4 } from 'uuid'
import { config } from '../../../src/config.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { OrganizationsUseCases } from '../../../src/core/users/organizations.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import {
  BadRequestError,
  PaymentRequiredError,
} from '../../../src/errors/index.js'
import { IntentsUseCases } from '../../../src/core/users/intents.js'

const admin = { role: UserRole.Admin, publicId: 'admin-pub' } as User
const DAY = 24 * 60 * 60 * 1000

describe('Partner account terms', () => {
  beforeEach(async () => {
    mockRabbitPublish()
    await getDatabase()
    await dbMigration.up()
  })

  afterEach(async () => {
    unmockMethods()
    jest.restoreAllMocks()
    await dbMigration.down()
  })

  // A partner organization and one member resolving to its account.
  const createPartner = async () => {
    const organizationId = uuidv4()
    jest
      .spyOn(AuthManager, 'createOrganization')
      .mockResolvedValue(ok({ id: organizationId, name: 'Partner' }))
    await OrganizationsUseCases.createPartnerOrganization(admin, 'Partner')
    const member = { ...createMockUser(), organizationId }
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(member)
    const account = await AccountsUseCases.getOrCreateAccount(member)
    return { member, account }
  }

  const grant = async (
    accountId: string,
    userPublicId: string,
    bytes: bigint,
  ) => {
    const db = await getDatabase()
    const id = `intent-${uuidv4()}`
    await db.query(
      `INSERT INTO intents (id, user_public_id, status, shannons_per_byte, expires_at, account_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userPublicId, IntentStatus.COMPLETED, '1', new Date(), accountId],
    )
    return AccountsUseCases.addCreditsToAccount(
      { id, userPublicId, accountId },
      bytes,
    )
  }

  const setTerms = (
    accountId: string,
    terms: {
      maxPurchasedBytes?: number | null
      creditExpiryDays?: number | null
    },
  ) =>
    AccountsUseCases.updateAccount(
      admin,
      accountId,
      AccountModel.Monthly,
      0,
      1000,
      terms,
    )

  describe('creation', () => {
    it('gives a partner account no free uploads, the monthly model and the default download allowance', async () => {
      const { account } = await createPartner()

      expect(account).toMatchObject({
        isPartner: true,
        model: AccountModel.Monthly,
        uploadLimit: 0,
        downloadLimit: config.params.defaultAccount.downloadLimit,
        maxPurchasedBytes: null,
        creditExpiryDays: null,
      })
    })

    it('records the partner flag with the admin who set it', async () => {
      const { account } = await createPartner()

      const changes = (
        await AccountsUseCases.adminGetTermsChanges(admin, account.id)
      )._unsafeUnwrap()
      expect(changes).toEqual([
        expect.objectContaining({
          accountId: account.id,
          field: 'is_partner',
          oldValue: 'false',
          newValue: 'true',
          changedBy: 'admin-pub',
          reason: null,
        }),
      ])
    })
  })

  describe('uploads and downloads', () => {
    it('rejects an upload beyond the purchased credits and leaves no trace', async () => {
      const { member, account } = await createPartner()
      await grant(account.id, member.publicId, 100n)

      await expect(
        AccountsUseCases.registerInteraction(
          member,
          InteractionType.Upload,
          101n,
        ),
      ).rejects.toBeInstanceOf(PaymentRequiredError)

      const { uploadBytesRemaining } =
        await purchasedCreditsRepository.getRemainingCredits(account.id)
      expect(uploadBytesRemaining).toBe(100n)
    })

    it('accepts an upload within the purchased credits', async () => {
      const { member, account } = await createPartner()
      await grant(account.id, member.publicId, 100n)

      await AccountsUseCases.registerInteraction(
        member,
        InteractionType.Upload,
        100n,
      )

      const { uploadBytesRemaining } =
        await purchasedCreditsRepository.getRemainingCredits(account.id)
      expect(uploadBytesRemaining).toBe(0n)
    })

    it('rejects an upload when nothing has been purchased', async () => {
      const { member } = await createPartner()

      await expect(
        AccountsUseCases.registerInteraction(
          member,
          InteractionType.Upload,
          1n,
        ),
      ).rejects.toBeInstanceOf(PaymentRequiredError)
    })

    it('accepts downloads within the allowance and rejects beyond it', async () => {
      const { member, account } = await createPartner()
      expect((await setTerms(account.id, {})).isOk()).toBe(true)

      await AccountsUseCases.registerInteraction(
        member,
        InteractionType.Download,
        1000n,
      )
      await expect(
        AccountsUseCases.registerInteraction(
          member,
          InteractionType.Download,
          1n,
        ),
      ).rejects.toBeInstanceOf(PaymentRequiredError)
    })
  })

  describe('credit terms', () => {
    it('expires a new batch after the credit expiry override', async () => {
      const { member, account } = await createPartner()
      await setTerms(account.id, { creditExpiryDays: 1095 })

      const before = Date.now()
      expect((await grant(account.id, member.publicId, 10n)).isOk()).toBe(true)

      const [batch] = await purchasedCreditsRepository.getByAccountId(
        account.id,
      )
      const days = (batch.expiresAt.getTime() - before) / DAY
      expect(days).toBeGreaterThanOrEqual(1095)
      expect(days).toBeLessThan(1095.01)
    })

    it('uses the global expiry for an account without an override', async () => {
      const member = createMockUser()
      const account = await AccountsUseCases.getOrCreateAccount(member)
      jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(member)

      const before = Date.now()
      await grant(account.id, member.publicId, 10n)

      const [batch] = await purchasedCreditsRepository.getByAccountId(
        account.id,
      )
      const days = (batch.expiresAt.getTime() - before) / DAY
      expect(days).toBeGreaterThanOrEqual(config.credits.expiryDays)
      expect(days).toBeLessThan(config.credits.expiryDays + 0.01)
    })

    it('does not move the expiry of batches already granted', async () => {
      const { member, account } = await createPartner()
      await grant(account.id, member.publicId, 10n)
      const [before] = await purchasedCreditsRepository.getByAccountId(
        account.id,
      )

      await setTerms(account.id, { creditExpiryDays: 1095 })

      const [after] = await purchasedCreditsRepository.getByAccountId(
        account.id,
      )
      expect(after.expiresAt).toEqual(before.expiresAt)
    })

    it('grants above the global cap up to the cap override', async () => {
      const { member, account } = await createPartner()
      const globalCap = config.credits.maxBytesPerAccount
      await setTerms(account.id, {
        maxPurchasedBytes: Number(globalCap) * 2,
      })

      expect((await grant(account.id, member.publicId, globalCap)).isOk()).toBe(
        true,
      )
      expect((await grant(account.id, member.publicId, globalCap)).isOk()).toBe(
        true,
      )
      expect((await grant(account.id, member.publicId, 1n)).isErr()).toBe(true)
    })

    it('keeps the global cap for an account without an override', async () => {
      const member = createMockUser()
      const account = await AccountsUseCases.getOrCreateAccount(member)
      jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(member)
      const globalCap = config.credits.maxBytesPerAccount

      expect((await grant(account.id, member.publicId, globalCap)).isOk()).toBe(
        true,
      )
      expect((await grant(account.id, member.publicId, 1n)).isErr()).toBe(true)
    })

    it('checks the cap override when an intent is created', async () => {
      const { member, account } = await createPartner()
      const globalCap = config.credits.maxBytesPerAccount
      await setTerms(account.id, {
        maxPurchasedBytes: Number(globalCap) * 2,
      })
      jest
        .spyOn(IntentsUseCases, 'getPrice')
        .mockResolvedValue({ price: 1, pricePerGB: 1073741824 })

      const within = await IntentsUseCases.createIntent(member, {
        requestedBytes: globalCap + 1n,
      })
      const above = await IntentsUseCases.createIntent(member, {
        requestedBytes: globalCap * 2n + 1n,
      })

      expect(within.isOk()).toBe(true)
      expect(above._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    })
  })

  describe('updateAccount history', () => {
    it('writes a row for each changed field only', async () => {
      const { account } = await createPartner()

      const result = await AccountsUseCases.updateAccount(
        admin,
        account.id,
        AccountModel.Monthly,
        0,
        999,
        { maxPurchasedBytes: 5000, reason: 'Agreed with Acme' },
      )
      expect(result.isOk()).toBe(true)

      const changes = (
        await AccountsUseCases.adminGetTermsChanges(admin, account.id)
      )._unsafeUnwrap()
      const added = changes.filter((c) => c.field !== 'is_partner')
      expect(
        added.map(({ field, oldValue, newValue }) => ({
          field,
          oldValue,
          newValue,
        })),
      ).toEqual(
        expect.arrayContaining([
          { field: 'max_purchased_bytes', oldValue: null, newValue: '5000' },
          {
            field: 'download_limit',
            oldValue: String(config.params.defaultAccount.downloadLimit),
            newValue: '999',
          },
        ]),
      )
      expect(added).toHaveLength(2)
      for (const change of added) {
        expect(change).toMatchObject({
          changedBy: 'admin-pub',
          reason: 'Agreed with Acme',
        })
      }
    })

    it('writes nothing when nothing changed', async () => {
      const { account } = await createPartner()
      await setTerms(account.id, { maxPurchasedBytes: 5000 })
      const count = async () =>
        (await accountsRepository.getTermsChanges(account.id)).length
      const before = await count()

      await setTerms(account.id, { maxPurchasedBytes: 5000 })
      await setTerms(account.id, {})

      expect(await count()).toBe(before)
    })

    it('records clearing an override, and keeps it when the field is omitted', async () => {
      const { account } = await createPartner()
      await setTerms(account.id, {
        maxPurchasedBytes: 5000,
        creditExpiryDays: 30,
      })
      await setTerms(account.id, { creditExpiryDays: null })

      const stored = await accountsRepository.getById(account.id)
      expect(stored).toMatchObject({
        maxPurchasedBytes: 5000,
        creditExpiryDays: null,
      })
      const [latest] = await accountsRepository.getTermsChanges(account.id)
      expect(latest).toMatchObject({
        field: 'credit_expiry_days',
        oldValue: '30',
        newValue: null,
      })
    })

    it('records model and upload limit changes on a personal account', async () => {
      const member = createMockUser()
      const account = await AccountsUseCases.getOrCreateAccount(member)

      await AccountsUseCases.updateAccount(
        admin,
        account.id,
        AccountModel.Monthly,
        account.uploadLimit + 1,
        account.downloadLimit,
      )

      expect(
        (await accountsRepository.getTermsChanges(account.id))
          .map((c) => c.field)
          .sort(),
      ).toEqual(['model', 'upload_limit'])
    })

    it('rejects a free upload allowance on a partner account', async () => {
      const { account } = await createPartner()

      const result = await AccountsUseCases.updateAccount(
        admin,
        account.id,
        AccountModel.Monthly,
        1,
        1000,
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      expect((await accountsRepository.getById(account.id))?.uploadLimit).toBe(
        0,
      )
    })

    it('rejects an invalid override at the database', async () => {
      const { account } = await createPartner()

      await expect(
        setTerms(account.id, { creditExpiryDays: 0 }),
      ).rejects.toThrow()
    })

    it('refuses the history to a non-admin', async () => {
      const { account } = await createPartner()

      const result = await AccountsUseCases.adminGetTermsChanges(
        { role: UserRole.User, publicId: 'someone' } as User,
        account.id,
      )

      expect(result.isErr()).toBe(true)
    })
  })
})
