import {
  AccountModel,
  IntentStatus,
  InteractionType,
  User,
  UserRole,
  UserWithOrganization,
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
import { CreditsUseCases } from '../../../src/core/users/credits.js'
import { IntentsUseCases } from '../../../src/core/users/intents.js'
import { OrganizationsUseCases } from '../../../src/core/users/organizations.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import {
  BadRequestError,
  ForbiddenError,
  ObjectNotFoundError,
  PaymentRequiredError,
} from '../../../src/errors/index.js'

const admin = { role: UserRole.Admin, publicId: 'admin-pub' } as User
const DAY = 24 * 60 * 60 * 1000
const TX_HASH = `0x${'b'.repeat(64)}`

describe('Partner free credits', () => {
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

  const setTerms = (
    accountId: string,
    terms: {
      monthlyFreeUploadBytes?: number
      creditExpiryDays?: number | null
    },
    uploadLimit = 0,
  ) =>
    AccountsUseCases.updateAccount(
      admin,
      accountId,
      AccountModel.Monthly,
      uploadLimit,
      1000,
      terms,
    )

  // A partner with monthly free credits, as read back from the database.
  const createMonthlyPartner = async (bytes: number) => {
    const { member, account } = await createPartner()
    expect(
      (await setTerms(account.id, { monthlyFreeUploadBytes: bytes })).isOk(),
    ).toBe(true)
    return { member, account: (await accountsRepository.getById(account.id))! }
  }

  const purchase = async (
    accountId: string,
    userPublicId: string,
    bytes: bigint,
  ) => {
    const db = await getDatabase()
    const id = `intent-${uuidv4()}`
    await db.query(
      `INSERT INTO intents (id, user_public_id, status, shannons_per_byte, expires_at, account_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userPublicId, IntentStatus.CONFIRMED, '1', new Date(), accountId],
    )
    return AccountsUseCases.addCreditsToAccount(
      { id, userPublicId, accountId },
      bytes,
    )
  }

  const grant = (
    accountId: string,
    uploadBytes: number,
    expiresInDays?: number,
  ) =>
    AccountsUseCases.grantFreeCredits(admin, accountId, {
      uploadBytes,
      expiresInDays,
      reason: 'Pilot',
    })

  const batches = (accountId: string) =>
    purchasedCreditsRepository.getByAccountId(accountId)

  // Bytes each upload drew from each kind of batch.
  const consumption = async (accountId: string) => {
    const db = await getDatabase()
    const { rows } = await db.query<{ kind: string; bytes: string }>(
      `SELECT CASE WHEN pc.intent_id IS NULL THEN 'free' ELSE 'purchase' END
                AS kind,
              c.bytes
       FROM interaction_credit_consumption c
       JOIN purchased_credits pc ON pc.id = c.purchased_credit_id
       WHERE pc.account_id = $1
       ORDER BY c.created_at, pc.intent_id IS NOT NULL`,
      [accountId],
    )
    return rows.map((r) => [r.kind, Number(r.bytes)])
  }

  const upload = (member: UserWithOrganization, bytes: bigint) =>
    AccountsUseCases.registerInteraction(member, InteractionType.Upload, bytes)

  describe('monthly free credits', () => {
    it('issues one batch per UTC month, however often and concurrently it is asked for', async () => {
      const { member, account } = await createMonthlyPartner(100)

      await Promise.all([
        ...Array.from({ length: 5 }, () =>
          AccountsUseCases.ensureMonthlyFreeCredits(account),
        ),
        AccountsUseCases.getPendingCreditsByUserAndType(
          member,
          InteractionType.Upload,
        ),
        CreditsUseCases.getSummary(member),
      ])
      await AccountsUseCases.ensureMonthlyFreeCredits(account)

      const now = new Date()
      const [batch, ...others] = await batches(account.id)
      expect(others).toHaveLength(0)
      expect(batch).toMatchObject({
        kind: 'free_monthly',
        intentId: null,
        uploadBytesOriginal: 100n,
        uploadBytesRemaining: 100n,
        grantPeriod: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        ),
        // At the start of the next UTC month.
        expiresAt: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
        ),
      })
    })

    it('issues nothing to a partner without them or to a personal account', async () => {
      const { account } = await createPartner()
      const personal =
        await AccountsUseCases.getOrCreateAccount(createMockUser())

      await AccountsUseCases.ensureMonthlyFreeCredits(account)
      await AccountsUseCases.ensureMonthlyFreeCredits({
        ...personal,
        monthlyFreeUploadBytes: 100,
      })

      expect(await batches(account.id)).toEqual([])
      expect(await batches(personal.id)).toEqual([])
    })

    it('lets a partner upload them and nothing beyond, then again next month', async () => {
      const { member, account } = await createMonthlyPartner(100)

      // The upload gate issues them.
      expect(
        await AccountsUseCases.getPendingCreditsByUserAndType(
          member,
          InteractionType.Upload,
        ),
      ).toBe(100)
      await upload(member, 60n)
      await expect(upload(member, 41n)).rejects.toBeInstanceOf(
        PaymentRequiredError,
      )
      await upload(member, 40n)
      await expect(upload(member, 1n)).rejects.toBeInstanceOf(
        PaymentRequiredError,
      )
      expect(await consumption(account.id)).toEqual([
        ['free', 60],
        ['free', 40],
      ])

      // Next month: this batch belongs to the month before and has ended.
      const db = await getDatabase()
      await db.query(
        `UPDATE purchased_credits
         SET grant_period = (grant_period - interval '1 month')::date,
             expires_at = NOW() - interval '1 second'
         WHERE account_id = $1`,
        [account.id],
      )
      await upload(member, 100n)
      expect(await batches(account.id)).toHaveLength(2)
    })

    it('issues them inside the upload itself', async () => {
      const { member, account } = await createMonthlyPartner(100)

      await upload(member, 100n)

      expect(await consumption(account.id)).toEqual([['free', 100]])
    })

    it('keeps the current batch when the monthly amount changes', async () => {
      const { member, account } = await createMonthlyPartner(100)
      await AccountsUseCases.ensureMonthlyFreeCredits(account)

      await setTerms(account.id, { monthlyFreeUploadBytes: 200 })

      const summary = await CreditsUseCases.getSummary(member)
      expect(summary.freeUploadBytesRemaining).toBe(100n)
      expect(await batches(account.id)).toHaveLength(1)
    })
  })

  describe('consumption order', () => {
    it('draws monthly free credits before purchased ones', async () => {
      const { member, account } = await createMonthlyPartner(100)
      await purchase(account.id, member.publicId, 1000n)

      await upload(member, 150n)

      expect(await consumption(account.id)).toEqual([
        ['free', 100],
        ['purchase', 50],
      ])
    })

    it('draws a grant that expires after a purchased batch first', async () => {
      const { member, account } = await createPartner()
      await setTerms(account.id, { creditExpiryDays: 10 })
      await purchase(account.id, member.publicId, 1000n)
      await grant(account.id, 300, 100)

      await upload(member, 200n)
      // Larger than the free bytes left: those, then purchased.
      await upload(member, 250n)

      expect(await consumption(account.id)).toEqual([
        ['free', 200],
        ['free', 100],
        ['purchase', 150],
      ])
      const summary = await CreditsUseCases.getSummary(member)
      expect(summary.freeUploadBytesRemaining).toBe(0n)
      expect(summary.uploadBytesRemaining).toBe(850n)
    })
  })

  describe('one-time grants', () => {
    it('records the batch with the admin and the reason', async () => {
      const { account } = await createPartner()

      const before = Date.now()
      const credit = (await grant(account.id, 5000, 30))._unsafeUnwrap()

      expect(credit).toMatchObject({
        accountId: account.id,
        kind: 'free_one_time',
        intentId: null,
        grantPeriod: null,
        uploadBytesOriginal: 5000n,
        uploadBytesRemaining: 5000n,
        downloadBytesOriginal: 0n,
        grantedBy: 'admin-pub',
        grantReason: 'Pilot',
      })
      // Set by the database clock, which may be a little off this one.
      const days = (credit.expiresAt.getTime() - before) / DAY
      expect(Math.abs(days - 30)).toBeLessThan(0.01)
      expect(
        (
          await AccountsUseCases.adminGetFreeCredits(admin, account.id)
        )._unsafeUnwrap(),
      ).toEqual([credit])
    })

    it('expires after the credit expiry of the account by default', async () => {
      const { account } = await createPartner()
      await setTerms(account.id, { creditExpiryDays: 1095 })

      const before = Date.now()
      const credit = (await grant(account.id, 1))._unsafeUnwrap()

      const days = (credit.expiresAt.getTime() - before) / DAY
      expect(Math.abs(days - 1095)).toBeLessThan(0.01)
    })

    it('is refused to a non-admin, a personal account and a missing one', async () => {
      const { account } = await createPartner()
      const personal =
        await AccountsUseCases.getOrCreateAccount(createMockUser())
      const nonAdmin = { role: UserRole.User, publicId: 'someone' } as User

      expect(
        (
          await AccountsUseCases.grantFreeCredits(nonAdmin, account.id, {
            uploadBytes: 1,
            reason: 'x',
          })
        )._unsafeUnwrapErr(),
      ).toBeInstanceOf(ForbiddenError)
      expect((await grant(personal.id, 1))._unsafeUnwrapErr()).toBeInstanceOf(
        BadRequestError,
      )
      expect((await grant('missing', 1))._unsafeUnwrapErr()).toBeInstanceOf(
        ObjectNotFoundError,
      )
      expect(
        (
          await AccountsUseCases.adminGetFreeCredits(nonAdmin, account.id)
        )._unsafeUnwrapErr(),
      ).toBeInstanceOf(ForbiddenError)
      expect(await batches(account.id)).toEqual([])
      expect(await batches(personal.id)).toEqual([])
    })

    it('shows members the batch without who granted it or why', async () => {
      const { member, account } = await createPartner()
      await grant(account.id, 10)

      const [batch] = await CreditsUseCases.getBatches(member)

      expect(batch.kind).toBe('free_one_time')
      expect(batch).not.toHaveProperty('grantedBy')
      expect(batch).not.toHaveProperty('grantReason')
      expect(
        (await AccountsUseCases.getAccountInfo(member)).freeUploadCredits,
      ).toBe(10)
    })
  })

  describe('holding cap', () => {
    it('leaves free credits out of the cap', async () => {
      const { member, account } = await createPartner()
      const cap = config.credits.maxBytesPerAccount
      await grant(account.id, Number(cap))
      jest
        .spyOn(IntentsUseCases, 'getPrice')
        .mockResolvedValue({ price: 1, pricePerGB: 1073741824 })

      const summary = await CreditsUseCases.getSummary(member)
      expect(summary).toMatchObject({
        maxPurchasableBytes: cap,
        canPurchase: true,
        freeUploadBytesRemaining: cap,
        uploadBytesRemaining: cap,
      })
      expect(
        (
          await IntentsUseCases.createIntent(member, { requestedBytes: cap })
        ).isOk(),
      ).toBe(true)
      expect((await purchase(account.id, member.publicId, cap)).isOk()).toBe(
        true,
      )
      expect((await purchase(account.id, member.publicId, 1n)).isErr()).toBe(
        true,
      )
    })
  })

  describe('refunds', () => {
    it('refuses to refund free credits, alone or with purchased ones', async () => {
      const { member, account } = await createPartner()
      await purchase(account.id, member.publicId, 100n)
      const free = (await grant(account.id, 100))._unsafeUnwrap()
      const paid = (await batches(account.id)).find(
        (b) => b.kind === 'purchase',
      )!

      const single = await CreditsUseCases.refundBatch(admin, free.id, TX_HASH)
      const bulk = await CreditsUseCases.refundBatches(
        admin,
        [paid.id, free.id],
        TX_HASH,
      )

      expect(single._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      expect(single._unsafeUnwrapErr().message).toBe(
        'Free credits cannot be refunded',
      )
      expect(bulk._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      expect(bulk._unsafeUnwrapErr().message).toContain(free.id)
      for (const batch of await batches(account.id)) {
        expect(batch).toMatchObject({
          refundedAt: null,
          uploadBytesRemaining: 100n,
        })
      }
    })
  })

  describe('monthly term', () => {
    it('records a change in the terms history', async () => {
      const { account } = await createPartner()

      expect(
        (await setTerms(account.id, { monthlyFreeUploadBytes: 1024 })).isOk(),
      ).toBe(true)

      const changes = await accountsRepository.getTermsChanges(account.id)
      expect(
        changes.find((c) => c.field === 'monthly_free_upload_bytes'),
      ).toMatchObject({
        oldValue: '0',
        newValue: '1024',
        changedBy: 'admin-pub',
      })
      expect(await accountsRepository.getById(account.id)).toMatchObject({
        monthlyFreeUploadBytes: 1024,
        uploadLimit: 0,
      })
    })

    it('is refused to a personal account', async () => {
      const personal =
        await AccountsUseCases.getOrCreateAccount(createMockUser())

      const result = await AccountsUseCases.updateAccount(
        admin,
        personal.id,
        AccountModel.Monthly,
        personal.uploadLimit,
        personal.downloadLimit,
        { monthlyFreeUploadBytes: 1 },
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      expect(
        (await accountsRepository.getById(personal.id))?.monthlyFreeUploadBytes,
      ).toBe(0)
    })

    it('still keeps a partner upload limit at 0', async () => {
      const { account } = await createPartner()

      const result = await setTerms(
        account.id,
        { monthlyFreeUploadBytes: 1024 },
        1,
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      expect(await accountsRepository.getById(account.id)).toMatchObject({
        monthlyFreeUploadBytes: 0,
        uploadLimit: 0,
      })
    })
  })

  it('stores each batch with exactly one source', async () => {
    const { account } = await createPartner()
    const db = await getDatabase()
    const insert = (source: { grantedBy?: string; grantPeriod?: string }) =>
      db.query(
        `INSERT INTO purchased_credits (account_id, upload_bytes_original,
           upload_bytes_remaining, download_bytes_original,
           download_bytes_remaining, expires_at, granted_by, grant_period)
         VALUES ($1, 1, 1, 0, 0, NOW() + interval '1 day', $2, $3)`,
        [account.id, source.grantedBy ?? null, source.grantPeriod ?? null],
      )
    const month = { grantPeriod: '2026-11-01' }

    await expect(insert({})).rejects.toThrow(/purchased_credits_one_source/)
    await expect(insert({ ...month, grantedBy: 'admin-pub' })).rejects.toThrow(
      /purchased_credits_one_source/,
    )
    await insert(month)
    await expect(insert(month)).rejects.toThrow(
      /purchased_credits_account_grant_period_key/,
    )
  })
})
