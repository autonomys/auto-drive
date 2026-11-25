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

  // The interactions ledger: what each upload was charged against.
  const ledger = async (accountId: string) => {
    const db = await getDatabase()
    const { rows } = await db.query<{ source: string; size: string }>(
      `SELECT source, size FROM interactions
       WHERE account_id = $1
       ORDER BY created_at, source`,
      [accountId],
    )
    return rows.map((r) => [r.source, Number(r.size)])
  }

  const freeCreditsLeft = async (member: UserWithOrganization) =>
    (await CreditsUseCases.getSummary(member)).freeUploadBytesRemaining

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

    it('applies a change to the amount at once: the new amount less what was used this month', async () => {
      const { member, account } = await createMonthlyPartner(100)
      await upload(member, 30n)

      await setTerms(account.id, { monthlyFreeUploadBytes: 200 })
      expect(await freeCreditsLeft(member)).toBe(170n)

      // Lowered below what was used: nothing is left, and nothing more can be
      // uploaded with them.
      await setTerms(account.id, { monthlyFreeUploadBytes: 20 })
      expect(await freeCreditsLeft(member)).toBe(0n)
      await expect(upload(member, 1n)).rejects.toBeInstanceOf(
        PaymentRequiredError,
      )

      await setTerms(account.id, { monthlyFreeUploadBytes: 0 })
      expect(await freeCreditsLeft(member)).toBe(0n)

      await setTerms(account.id, { monthlyFreeUploadBytes: 100 })
      expect(await freeCreditsLeft(member)).toBe(70n)
      await upload(member, 70n)
      expect(await freeCreditsLeft(member)).toBe(0n)

      // Each change ended the month's batch and issued the rest of the month
      // as a new one; the ended ones stay, with what they had left.
      const monthly = (await batches(account.id)).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )
      expect(
        monthly.map((b) => [
          Number(b.uploadBytesOriginal),
          Number(b.uploadBytesRemaining),
          b.supersededAt !== null,
        ]),
      ).toEqual([
        [100, 70, true],
        [170, 170, true],
        [70, 0, false],
      ])
      for (const ended of monthly.filter((b) => b.supersededAt)) {
        expect(ended.expiresAt.getTime()).toBe(ended.supersededAt!.getTime())
      }
    })

    it('changes as the upload limit of a regular account does', async () => {
      const { member, account } = await createMonthlyPartner(100)
      const regular = createMockUser()
      const regularAccount = await AccountsUseCases.getOrCreateAccount(regular)
      const setRegularLimit = (bytes: number) =>
        AccountsUseCases.updateAccount(
          admin,
          regularAccount.id,
          AccountModel.Monthly,
          bytes,
          1000,
        )
      await setRegularLimit(100)
      await upload(member, 30n)
      await upload(regular, 30n)

      for (const bytes of [200, 20, 0, 100]) {
        await setTerms(account.id, { monthlyFreeUploadBytes: bytes })
        await setRegularLimit(bytes)
        expect(
          await AccountsUseCases.getPendingCreditsByUserAndType(
            member,
            InteractionType.Upload,
          ),
        ).toBe(
          await AccountsUseCases.getPendingCreditsByUserAndType(
            regular,
            InteractionType.Upload,
          ),
        )
      }
    })

    it('issues the month at once when it is first set mid-month', async () => {
      const { member, account } = await createPartner()

      await setTerms(account.id, { monthlyFreeUploadBytes: 100 })

      expect(await batches(account.id)).toMatchObject([
        { kind: 'free_monthly', uploadBytesRemaining: 100n },
      ])
      expect(await freeCreditsLeft(member)).toBe(100n)
    })

    // Waits until another connection is blocked on a lock.
    const waitForLockWait = async () => {
      const db = await getDatabase()
      for (let i = 0; i < 200; i++) {
        const { rows } = await db.query<{ waiting: number }>(
          `SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        )
        if (rows[0].waiting > 0) return
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('No connection waited on a lock')
    }

    it('replaces a batch an upload is still issuing when the amount changes', async () => {
      const { member, account } = await createMonthlyPartner(100)
      const db = await getDatabase()
      // This month's batch is not issued yet.
      await db.query('DELETE FROM purchased_credits WHERE account_id = $1', [
        account.id,
      ])

      const client = await db.connect()
      try {
        await client.query('BEGIN')
        await purchasedCreditsRepository.ensureMonthlyFreeCredits(
          account.id,
          client,
        )
        const change = setTerms(account.id, { monthlyFreeUploadBytes: 200 })
        await waitForLockWait()
        await client.query('COMMIT')
        expect((await change).isOk()).toBe(true)
      } finally {
        client.release()
      }

      expect(await freeCreditsLeft(member)).toBe(200n)
    })

    it('waits for a change to the amount already under way before issuing', async () => {
      const { member, account } = await createMonthlyPartner(100)
      const db = await getDatabase()
      await db.query('DELETE FROM purchased_credits WHERE account_id = $1', [
        account.id,
      ])

      // The steps of updateAccount, held open after the account is locked.
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [
          account.id,
        ])
        await client.query(
          'UPDATE accounts SET monthly_free_upload_bytes = 200 WHERE id = $1',
          [account.id],
        )
        const issuing = purchasedCreditsRepository.ensureMonthlyFreeCredits(
          account.id,
        )
        await waitForLockWait()
        await purchasedCreditsRepository.supersedeMonthlyFreeCredits(
          client,
          account.id,
        )
        await purchasedCreditsRepository.ensureMonthlyFreeCredits(
          account.id,
          client,
        )
        await client.query('COMMIT')
        await issuing
      } finally {
        client.release()
      }

      expect(await freeCreditsLeft(member)).toBe(200n)
    })

    it('keeps an upload begun before a change off the replaced batch', async () => {
      const { account } = await createMonthlyPartner(100)
      const db = await getDatabase()

      const client = await db.connect()
      try {
        // NOW() in this transaction is from before the change.
        await client.query('BEGIN')
        await setTerms(account.id, { monthlyFreeUploadBytes: 50 })
        const consumed = await purchasedCreditsRepository.consumeUpTo(
          client,
          account.id,
          'upload',
          1000n,
        )
        await client.query('COMMIT')
        expect(consumed.map((c) => Number(c.bytes))).toEqual([50])
      } finally {
        client.release()
      }
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
      // The ledger records the two parts apart.
      expect(await ledger(account.id)).toEqual([
        ['free_credits', 100],
        ['purchased', 50],
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
        // Purchased credits only.
        uploadBytesRemaining: 0n,
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

    it('belongs to the monthly model: one-off ends it and refuses it', async () => {
      const { member, account } = await createMonthlyPartner(100)
      await upload(member, 30n)
      const oneOff = (monthlyFreeUploadBytes?: number) =>
        AccountsUseCases.updateAccount(
          admin,
          account.id,
          AccountModel.OneOff,
          0,
          1000,
          { monthlyFreeUploadBytes },
        )

      // Kept from before, or set: refused, and nothing changes.
      for (const bytes of [undefined, 100]) {
        expect((await oneOff(bytes))._unsafeUnwrapErr()).toBeInstanceOf(
          BadRequestError,
        )
      }
      expect(await freeCreditsLeft(member)).toBe(70n)

      // Switching with the amount at 0 ends this month's credits at once.
      expect((await oneOff(0)).isOk()).toBe(true)
      expect(await freeCreditsLeft(member)).toBe(0n)
      expect(await accountsRepository.getById(account.id)).toMatchObject({
        model: AccountModel.OneOff,
        monthlyFreeUploadBytes: 0,
      })
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
    // A replaced batch leaves room for the month's next one.
    await db.query(
      `UPDATE purchased_credits SET superseded_at = NOW()
       WHERE account_id = $1`,
      [account.id],
    )
    await insert(month)
  })

  it('leaves free credits out of the admin economics', async () => {
    const { member, account } = await createMonthlyPartner(100)
    await grant(account.id, 200, 10)
    await setTerms(account.id, { creditExpiryDays: 10 })
    await purchase(account.id, member.publicId, 50n)

    const economics = (
      await CreditsUseCases.getEconomics(admin)
    )._unsafeUnwrap()

    expect(economics).toMatchObject({
      totalExpiringWithin30Days: 1,
      totalExpiringUploadBytes: 50n,
    })
  })
})
