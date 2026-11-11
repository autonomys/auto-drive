import {
  AccountModel,
  CreditBalance,
  DeletionRequest,
  IntentStatus,
  PaymentMethod,
  UsageInteraction,
  User,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { jest } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'
import { config } from '../../../src/config.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { createMockUser, unmockMethods } from '../../utils/mocks.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { UsageReportsUseCases } from '../../../src/core/users/usageReports.js'
import { DeletionUseCases } from '../../../src/core/users/deletion.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { usageReportsRepository } from '../../../src/infrastructure/repositories/users/usageReports.js'
import {
  BadRequestError,
  ForbiddenError,
  ObjectNotFoundError,
} from '../../../src/errors/index.js'

const DAY = 24 * 60 * 60 * 1000
const admin = {
  role: UserRole.Admin,
  publicId: 'admin-pub',
} as UserWithOrganization

// Every event happens on a day of a timeline that ends before now.
const base = new Date(Date.now() - 80 * DAY)
const day = (n: number) => new Date(base.getTime() + n * DAY)
const NOW = new Date(Date.now() + DAY)

describe('Usage reports', () => {
  const attributionStart = config.usageReports.attributionStart

  beforeEach(async () => {
    await getDatabase()
    await dbMigration.up()
    config.usageReports.attributionStart = day(10)
    jest.spyOn(AuthManager, 'getApiKeyNames').mockResolvedValue([
      { id: 'key-1', name: 'Production', deletedAt: null },
      { id: 'key-2', name: '=HYPERLINK("x")', deletedAt: day(60) },
    ])
  })

  afterEach(async () => {
    config.usageReports.attributionStart = attributionStart
    unmockMethods()
    await dbMigration.down()
  })

  const createAccount = async (isPartner: boolean) => {
    const organizationId = uuidv4()
    const account = await accountsRepository.createAccount(
      uuidv4(),
      organizationId,
      AccountModel.Monthly,
      0,
      0,
      isPartner ? 'admin-pub' : undefined,
    )
    const member = (): UserWithOrganization => ({
      ...createMockUser(),
      organizationId,
    })
    return { account, member }
  }

  // A confirmed purchase granted at `at`, written directly so its times can be
  // set.
  const grant = async (
    accountId: string,
    {
      buyer,
      bytes,
      shannonsPerByte,
      at,
      expiresAt,
      usdc = false,
    }: {
      buyer: string
      bytes: number
      shannonsPerByte: number
      at: Date
      expiresAt: Date
      usdc?: boolean
    },
  ) => {
    const db = await getDatabase()
    const intentId = `intent-${uuidv4()}`
    await db.query(
      `INSERT INTO intents (id, user_public_id, status, shannons_per_byte,
         payment_method, payment_amount, token_amount, quoted_token_amount,
         quoted_ai3_shannons, account_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        intentId,
        buyer,
        IntentStatus.COMPLETED,
        shannonsPerByte,
        usdc ? PaymentMethod.USDC_ETH : PaymentMethod.AI3_NATIVE,
        usdc ? null : bytes * shannonsPerByte,
        usdc ? 2_500_000 : null,
        usdc ? 2_500_000 : null,
        usdc ? bytes * shannonsPerByte : null,
        accountId,
        at,
      ],
    )
    const result = await db.query<{ id: string }>(
      `INSERT INTO purchased_credits (account_id, intent_id,
         upload_bytes_original, upload_bytes_remaining,
         download_bytes_original, download_bytes_remaining,
         purchased_at, expires_at)
       VALUES ($1, $2, $3, $3, 0, 0, $4, $5) RETURNING id`,
      [accountId, intentId, bytes, at, expiresAt],
    )
    return result.rows[0].id
  }

  // An interaction at `at`. Purchased uploads draw `from` the given batches;
  // `recorded: false` draws without consumption rows, as before attribution.
  const interact = async (
    accountId: string,
    {
      at,
      bytes,
      type = 'upload',
      apiKeyId = null,
      from = [],
      recorded = true,
    }: {
      at: Date
      bytes: number
      type?: 'upload' | 'download'
      apiKeyId?: string | null
      from?: [string, number][]
      recorded?: boolean
    },
  ) => {
    const db = await getDatabase()
    const id = uuidv4()
    await db.query(
      `INSERT INTO interactions (id, account_id, type, size, source, cid,
         api_key_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz::timestamp)`,
      [
        id,
        accountId,
        type,
        bytes,
        from.length > 0 ? 'purchased' : 'free_tier',
        `cid-${id}`,
        apiKeyId,
        at,
      ],
    )
    for (const [batchId, drawn] of from) {
      await db.query(
        `UPDATE purchased_credits
         SET upload_bytes_remaining = upload_bytes_remaining - $2
         WHERE id = $1`,
        [batchId, drawn],
      )
      if (recorded) {
        await db.query(
          `INSERT INTO interaction_credit_consumption
             (interaction_id, purchased_credit_id, bytes, created_at)
           VALUES ($1, $2, $3, $4)`,
          [id, batchId, drawn, at],
        )
      }
    }
    return id
  }

  const refund = async (batchId: string, at: Date) => {
    await purchasedCreditsRepository.markAsRefunded(
      batchId,
      `0x${'a'.repeat(64)}`,
    )
    const db = await getDatabase()
    await db.query(
      'UPDATE purchased_credits SET refunded_at = $2 WHERE id = $1',
      [batchId, at],
    )
  }

  // A partner account with a timeline that exercises every balance movement.
  // Attribution starts on day 10.
  const seedPartner = async () => {
    const partner = await createAccount(true)
    const alice = partner.member()
    const bob = partner.member()
    const id = partner.account.id

    // Granted before attribution; 100 bytes used then, unrecorded. Expires on
    // day 40 with 400 bytes left.
    const a = await grant(id, {
      buyer: alice.publicId,
      bytes: 1000,
      shannonsPerByte: 2,
      at: day(5),
      expiresAt: day(40),
    })
    await interact(id, {
      at: day(7),
      bytes: 100,
      from: [[a, 100]],
      recorded: false,
    })
    await interact(id, {
      at: day(12),
      bytes: 300,
      apiKeyId: 'key-1',
      from: [[a, 300]],
    })

    // Bought by another member, in USDC, at a higher price. Still live.
    const b = await grant(id, {
      buyer: bob.publicId,
      bytes: 2000,
      shannonsPerByte: 5,
      at: day(15),
      expiresAt: NOW,
      usdc: true,
    })
    // One upload drawing on both batches.
    await interact(id, {
      at: day(20),
      bytes: 700,
      apiKeyId: 'key-2',
      from: [
        [a, 200],
        [b, 500],
      ],
    })
    await interact(id, { at: day(22), bytes: 50, apiKeyId: 'key-1' })
    await interact(id, {
      at: day(23),
      bytes: 4000,
      type: 'download',
      apiKeyId: 'key-1',
    })

    // Refunded on day 30 with 400 bytes left.
    const c = await grant(id, {
      buyer: alice.publicId,
      bytes: 500,
      shannonsPerByte: 3,
      at: day(25),
      expiresAt: NOW,
    })
    await interact(id, { at: day(27), bytes: 100, from: [[c, 100]] })
    await refund(c, day(30))

    // Expires unused on day 45 and is refunded afterwards, which moves no
    // bytes.
    const d = await grant(id, {
      buyer: alice.publicId,
      bytes: 800,
      shannonsPerByte: 1,
      at: day(35),
      expiresAt: day(45),
    })
    await refund(d, day(50))

    return { ...partner, alice, bob, batches: { a, b, c, d } }
  }

  const report = async (
    executor: UserWithOrganization,
    accountId: string,
    from: Date,
    to: Date,
  ) =>
    (
      await UsageReportsUseCases.getUsageReport(executor, accountId, {
        from,
        to,
      })
    )._unsafeUnwrap()

  const balanceHolds = (balance: CreditBalance) =>
    BigInt(balance.opening) +
      BigInt(balance.granted) -
      BigInt(balance.consumed) -
      BigInt(balance.expired) -
      BigInt(balance.refunded) ===
    BigInt(balance.closing)

  it('reconciles the balance with the batches over the whole timeline', async () => {
    const { account, member } = await seedPartner()

    const { balance } = await report(member(), account.id, day(10), NOW)

    expect(balance).toEqual({
      opening: '900',
      granted: '3300',
      consumed: '1100',
      expired: '1200',
      refunded: '400',
      closing: '1500',
    })
    // The closing balance is what the live batches hold now.
    const remaining = await purchasedCreditsRepository.getRemainingCredits(
      account.id,
    )
    expect(balance?.closing).toBe(remaining.uploadBytesRemaining.toString())
  })

  it('expires the credits an account deletion forfeits when it happens', async () => {
    const personal = await createAccount(false)
    const user = personal.member()
    const id = personal.account.id
    const batch = await grant(id, {
      buyer: user.publicId,
      bytes: 1000,
      shannonsPerByte: 1,
      at: day(20),
      expiresAt: NOW,
    })
    await interact(id, { at: day(30), bytes: 100, from: [[batch, 100]] })
    const request = {
      id: uuidv4(),
      userPublicId: user.publicId,
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
    } as DeletionRequest
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(user)
    jest
      .spyOn(AuthManager, 'markDeletionAsProcessing')
      .mockResolvedValue(request)
    jest
      .spyOn(AuthManager, 'executeAuthAnonymisation')
      .mockResolvedValue(undefined)
    jest
      .spyOn(AuthManager, 'markDeletionAsCompleted')
      .mockResolvedValue(request)

    await DeletionUseCases.processAnonymisation(request)

    const { balance } = await report(admin, id, day(10), NOW)
    expect(balance).toEqual({
      opening: '0',
      granted: '1000',
      consumed: '100',
      expired: '900',
      refunded: '0',
      closing: '0',
    })
    const remaining = await purchasedCreditsRepository.getRemainingCredits(id)
    expect(balance?.closing).toBe(remaining.uploadBytesRemaining.toString())
    // Held until the deletion, not before.
    expect((await report(admin, id, day(10), day(79))).balance?.closing).toBe(
      '900',
    )
  })

  it('keeps the balance identity for any range from attribution on', async () => {
    const { account } = await seedPartner()
    const days = [10, 11, 12, 13, 20, 21, 26, 30, 31, 40, 41, 45, 46, 50, 79]

    for (const from of days) {
      for (const to of days.filter((d) => d > from)) {
        const { balance } = await report(admin, account.id, day(from), day(to))
        expect({ from, to, holds: balanceHolds(balance!) }).toEqual({
          from,
          to,
          holds: true,
        })
      }
    }
  })

  it('has no balance for a range starting before attribution', async () => {
    const { account } = await seedPartner()

    expect((await report(admin, account.id, day(9), NOW)).balance).toBeNull()

    config.usageReports.attributionStart = null
    expect((await report(admin, account.id, day(11), NOW)).balance).toBeNull()
  })

  it('values consumption at the price of each batch, in AI3 and in USDC', async () => {
    const { account } = await seedPartner()

    const { uploads } = await report(admin, account.id, day(0), NOW)

    // 300 × 2, then 200 × 2 + 500 × 5 for the upload spanning two batches,
    // then 100 × 3. The unrecorded day-7 upload has no value.
    expect(uploads).toEqual({
      count: 5,
      bytes: '1250',
      freeTierBytes: '50',
      purchasedBytes: '1200',
      unattributedBytes: '100',
      ai3Value: '3800',
    })
  })

  it('breaks usage down by API key, summing to the totals', async () => {
    const { account } = await seedPartner()

    const { apiKeys, uploads, downloads } = await report(
      admin,
      account.id,
      day(0),
      NOW,
    )

    expect(apiKeys).toEqual([
      expect.objectContaining({
        kind: 'apiKey',
        apiKeyId: 'key-2',
        deleted: true,
        uploadBytes: '700',
        ai3Value: '2900',
      }),
      expect.objectContaining({
        kind: 'apiKey',
        apiKeyId: 'key-1',
        name: 'Production',
        uploadCount: 2,
        uploadBytes: '350',
        purchasedBytes: '300',
        ai3Value: '600',
        downloadCount: 1,
        downloadBytes: '4000',
      }),
      expect.objectContaining({ kind: 'session', uploadBytes: '100' }),
      expect.objectContaining({ kind: 'unattributed', uploadBytes: '100' }),
    ])
    const total = (field: 'uploadBytes' | 'ai3Value' | 'downloadBytes') =>
      apiKeys.reduce((sum, key) => sum + BigInt(key[field]), BigInt(0))
    expect(total('uploadBytes')).toBe(BigInt(uploads.bytes))
    expect(total('ai3Value')).toBe(BigInt(uploads.ai3Value))
    expect(total('downloadBytes')).toBe(BigInt(downloads.bytes))
  })

  it('leaves keys unnamed when auth cannot name them', async () => {
    const { account } = await seedPartner()
    jest
      .spyOn(AuthManager, 'getApiKeyNames')
      .mockRejectedValue(new Error('auth is down'))
    const range = { from: day(0), to: NOW }

    const { apiKeys } = await report(admin, account.id, range.from, range.to)
    const result = (
      await UsageReportsUseCases.getUsageInteractions(admin, account.id, range)
    )._unsafeUnwrap()
    const interactions: UsageInteraction[] = []
    for await (const page of result.pages) interactions.push(...page)

    expect(
      apiKeys
        .filter((key) => key.kind === 'apiKey')
        .map((key) => [key.apiKeyId, key.name]),
    ).toEqual([
      ['key-2', null],
      ['key-1', null],
    ])
    expect(
      interactions
        .filter((i) => i.apiKeyId)
        .map((i) => [i.apiKeyId, i.apiKeyName]),
    ).toEqual([
      ['key-1', null],
      ['key-2', null],
      ['key-1', null],
      ['key-1', null],
    ])
  })

  it('lists the purchases of every member, and only those', async () => {
    const { account, alice, bob, batches } = await seedPartner()
    // Alice's purchase on her personal account before she joined.
    const personal = await createAccount(false)
    await grant(personal.account.id, {
      buyer: alice.publicId,
      bytes: 100,
      shannonsPerByte: 1,
      at: day(1),
      expiresAt: day(90),
    })

    const { purchases } = await report(admin, account.id, day(0), NOW)

    expect(purchases.map((p) => [p.batchId, p.buyer, p.paymentMethod])).toEqual(
      [
        [batches.a, alice.publicId, PaymentMethod.AI3_NATIVE],
        [batches.b, bob.publicId, PaymentMethod.USDC_ETH],
        [batches.c, alice.publicId, PaymentMethod.AI3_NATIVE],
        [batches.d, alice.publicId, PaymentMethod.AI3_NATIVE],
      ],
    )
    expect(purchases[2]).toMatchObject({
      refundedAt: day(30).toISOString(),
      refundedBytes: '400',
    })
  })

  it('lets members and admins read a report, and no one else', async () => {
    const { account, member } = await seedPartner()
    const other = await createAccount(false)
    const range = { from: day(0), to: NOW }

    const read = (executor: UserWithOrganization, accountId = account.id) =>
      UsageReportsUseCases.getUsageReport(executor, accountId, range)

    expect((await read(member())).isOk()).toBe(true)
    expect((await read(admin)).isOk()).toBe(true)
    expect((await read(other.member()))._unsafeUnwrapErr()).toBeInstanceOf(
      ForbiddenError,
    )
    expect((await read(member(), 'missing'))._unsafeUnwrapErr()).toBeInstanceOf(
      ForbiddenError,
    )
    expect((await read(admin, 'missing'))._unsafeUnwrapErr()).toBeInstanceOf(
      ObjectNotFoundError,
    )
  })

  it('rejects a range that has not started', async () => {
    const { account } = await seedPartner()

    const result = await UsageReportsUseCases.getUsageReport(
      admin,
      account.id,
      {
        from: NOW,
        to: new Date(NOW.getTime() + DAY),
      },
    )

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('exports the same figures as CSV', async () => {
    const { account } = await seedPartner()
    const json = await report(admin, account.id, day(10), NOW)

    const summary = UsageReportsUseCases.usageReportCsv(json, 'summary')
    const apiKeys = UsageReportsUseCases.usageReportCsv(json, 'apiKeys')
    const purchases = UsageReportsUseCases.usageReportCsv(json, 'purchases')

    expect(summary).toContain('upload_bytes,1150\r\n')
    expect(summary).toContain('ai3_value,0.0000000000000038\r\n')
    expect(summary).toContain('closing_balance_bytes,1500\r\n')
    // A key name a spreadsheet would run is quoted as text.
    expect(apiKeys).toContain('"\'=HYPERLINK(""x"")"')
    // 2.5 USDC for 10,000 shannons of AI3.
    expect(purchases.split('\r\n')[1]).toContain(
      ',usdc_eth,2.5,250000000000000,',
    )
  })

  it('exports every interaction in time order, across pages', async () => {
    const { account } = await seedPartner()
    // More interactions than a page, all at the same time, so paging has to
    // break ties by ID.
    const db = await getDatabase()
    await db.query(
      `INSERT INTO interactions (id, account_id, type, size, source, created_at)
       SELECT gen_random_uuid()::text, $1, 'download', 1, 'free_tier',
              $2::timestamptz::timestamp
       FROM generate_series(1, 5001)`,
      [account.id, day(60)],
    )

    const result = (
      await UsageReportsUseCases.getUsageInteractions(admin, account.id, {
        from: day(0),
        to: NOW,
      })
    )._unsafeUnwrap()
    const interactions: UsageInteraction[] = []
    for await (const page of result.pages) interactions.push(...page)

    expect(interactions).toHaveLength(5007)
    expect(new Set(interactions.map((i) => i.id)).size).toBe(5007)
    expect(interactions[0]).toMatchObject({
      createdAt: day(7).toISOString(),
      apiKeyName: null,
      ai3Value: null,
    })
    expect(interactions[2]).toMatchObject({
      createdAt: day(20).toISOString(),
      apiKeyName: '=HYPERLINK("x")',
      ai3Value: '2900',
    })
  })

  // Whether the planner picks an index depends on the table's size, so the
  // plans are taken with sequential scans and sorts made as costly as they go.
  // Each export page is then read in order from its index rather than sorting
  // the rest of the range, and the admin list reads only the range.
  it('has indexes for the export pages and the admin list', async () => {
    const { account } = await seedPartner()
    const db = await getDatabase()
    const capture = async (run: () => Promise<unknown>) => {
      const spy = jest.spyOn(db, 'query')
      try {
        await run()
        return spy.mock.calls[0] as unknown as [string, unknown[]]
      } finally {
        spy.mockRestore()
      }
    }
    const plan = async ([text, values]: [string, unknown[]]) => {
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        await client.query('SET LOCAL enable_seqscan = off')
        await client.query('SET LOCAL enable_sort = off')
        const { rows } = await client.query(`EXPLAIN ${text}`, values)
        return rows
          .map((r: Record<string, string>) => r['QUERY PLAN'])
          .join('\n')
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
    }

    const page = await plan(
      await capture(() =>
        usageReportsRepository.getInteractionsPage(
          account.id,
          day(0),
          NOW,
          { cursor: '2026-01-01 00:00:00', id: 'x' },
          5000,
        ),
      ),
    )
    const list = await plan(
      await capture(() =>
        usageReportsRepository.getAccountSummaries(day(0), NOW, false, 100),
      ),
    )

    expect(page).toMatch(
      /Index Scan using idx_interactions_account_created_at_id/,
    )
    expect(page).not.toMatch(/Sort/)
    expect(list).toMatch(/idx_interactions_created_at\b/)
  })

  it('lists headline figures per account for admins only', async () => {
    const { account } = await seedPartner()
    const personal = await createAccount(false)
    await grant(personal.account.id, {
      buyer: 'someone',
      bytes: 100,
      shannonsPerByte: 1,
      at: day(1),
      expiresAt: day(90),
    })
    // Accounts are listed without their names when auth can't give them.
    jest
      .spyOn(AuthManager, 'getOrganizationSummaries')
      .mockRejectedValue(new Error('auth is down'))
    const range = { from: day(0), to: NOW }

    const all = (
      await UsageReportsUseCases.adminGetAccountUsageSummaries(admin, range, {
        partnersOnly: false,
        limit: 100,
      })
    )._unsafeUnwrap()
    const partners = (
      await UsageReportsUseCases.adminGetAccountUsageSummaries(admin, range, {
        partnersOnly: true,
        limit: 100,
      })
    )._unsafeUnwrap()

    expect(all.map((a) => a.accountId)).toEqual([
      account.id,
      personal.account.id,
    ])
    expect(partners).toEqual([
      {
        accountId: account.id,
        organizationId: account.organizationId,
        organizationName: null,
        isPartner: true,
        uploadCount: 5,
        uploadBytes: '1250',
        ai3Value: '3800',
        downloadBytes: '4000',
        grantedBytes: '4300',
      },
    ])
    const nonAdmin = { role: UserRole.User } as User
    expect(
      (
        await UsageReportsUseCases.adminGetAccountUsageSummaries(
          nonAdmin,
          range,
          { partnersOnly: false, limit: 100 },
        )
      )._unsafeUnwrapErr(),
    ).toBeInstanceOf(ForbiddenError)
  })
})
