import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { intentsRepository } from '../../../src/infrastructure/repositories/users/intents.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { IntentStatus, PaymentMethod } from '@auto-drive/models'
import { dbMigration } from '../../utils/dbMigrate.js'

// Exercises markExpiredCredits against the migrated TestContainers Postgres
// (requires Docker), like the other repository specs.
//
// Regression coverage for the depleted-vs-expired bug: rows whose credits
// were fully consumed before expires_at passed must NOT be flagged expired —
// nothing was forfeited and no refund is owed, so they must never surface in
// the admin panel as "awaiting refund".
describe('PurchasedCredits Repository — markExpiredCredits', () => {
  const ACCOUNT_ID = 'account-expiry-spec'

  beforeAll(async () => {
    await dbMigration.up()
    await accountsRepository.createAccount(
      ACCOUNT_ID,
      'org-expiry-spec',
      'monthly',
      0,
      0,
    )
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  const createBatch = async (params: {
    intentId: string
    uploadOriginal: bigint
    uploadRemaining: bigint
    expiresAt: Date
    // Payment-asset shape of the originating intent. Defaulted so every
    // existing caller keeps describing a plain AI3 purchase.
    userPublicId?: string
    paymentMethod?: PaymentMethod
    paymentAmount?: bigint
    tokenAmount?: bigint
    quotedTokenAmount?: bigint
    quotedAi3Shannons?: bigint
    fromAddress?: string
  }) => {
    await intentsRepository.createIntent({
      id: params.intentId,
      userPublicId: params.userPublicId ?? `user-${params.intentId}`,
      status: IntentStatus.COMPLETED,
      shannonsPerByte: 1000n,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      paymentMethod: params.paymentMethod ?? PaymentMethod.AI3_NATIVE,
      paymentAmount: params.paymentAmount,
      tokenAmount: params.tokenAmount,
      quotedTokenAmount: params.quotedTokenAmount,
      quotedAi3Shannons: params.quotedAi3Shannons,
    })

    // from_address is written on confirmation rather than at creation, so it
    // is set directly here — the admin read path joins it like any other
    // intent column.
    if (params.fromAddress) {
      const db = await getDatabase()
      await db.query('UPDATE intents SET from_address = $1 WHERE id = $2', [
        params.fromAddress,
        params.intentId,
      ])
    }

    const row = await purchasedCreditsRepository.createPurchasedCredit({
      accountId: ACCOUNT_ID,
      intentId: params.intentId,
      uploadBytesOriginal: params.uploadOriginal,
      downloadBytesOriginal: 0n,
      expiresAt: params.expiresAt,
    })

    // Simulate consumption directly — consumeUpTo would refuse to touch a
    // past-expiry row, which is exactly the state we need to reproduce.
    const db = await getDatabase()
    await db.query(
      'UPDATE purchased_credits SET upload_bytes_remaining = $1 WHERE id = $2',
      [params.uploadRemaining.toString(), row.id],
    )

    return row.id
  }

  const getExpiredFlag = async (id: string): Promise<boolean> => {
    const db = await getDatabase()
    const result = await db.query<{ expired: boolean }>(
      'SELECT expired FROM purchased_credits WHERE id = $1',
      [id],
    )
    return result.rows[0].expired
  }

  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  it('marks past-expiry rows with remaining bytes as expired and reports forfeited totals', async () => {
    const id = await createBatch({
      intentId: 'expiry-unused',
      uploadOriginal: 1000n,
      uploadRemaining: 400n,
      expiresAt: pastDate,
    })

    const summary = await purchasedCreditsRepository.markExpiredCredits()

    expect(summary.expiredCount).toBe(1)
    expect(summary.totalUploadBytesForfeited).toBe(400n)
    expect(summary.totalDownloadBytesForfeited).toBe(0n)
    expect(await getExpiredFlag(id)).toBe(true)
  })

  it('does NOT mark fully depleted past-expiry rows as expired', async () => {
    const id = await createBatch({
      intentId: 'expiry-depleted',
      uploadOriginal: 1000n,
      uploadRemaining: 0n,
      expiresAt: pastDate,
    })

    const summary = await purchasedCreditsRepository.markExpiredCredits()

    expect(summary.expiredCount).toBe(0)
    expect(summary.totalUploadBytesForfeited).toBe(0n)
    expect(await getExpiredFlag(id)).toBe(false)
  })

  it('leaves rows that have not reached expires_at untouched', async () => {
    const id = await createBatch({
      intentId: 'expiry-active',
      uploadOriginal: 1000n,
      uploadRemaining: 1000n,
      expiresAt: futureDate,
    })

    const summary = await purchasedCreditsRepository.markExpiredCredits()

    expect(summary.expiredCount).toBe(0)
    expect(await getExpiredFlag(id)).toBe(false)
  })

  // ---------------------------------------------------------------------
  // Refund guard: depleted rows (0 upload bytes remaining) must not be
  // markable as refunded — nothing was forfeited, so no refund is owed.
  // ---------------------------------------------------------------------

  const TX_HASH = `0x${'a'.repeat(64)}`

  describe('markAsRefunded', () => {
    it('rejects a fully depleted row as notRefundable', async () => {
      const id = await createBatch({
        intentId: 'refund-depleted',
        uploadOriginal: 1000n,
        uploadRemaining: 0n,
        expiresAt: pastDate,
      })

      const result = await purchasedCreditsRepository.markAsRefunded(
        id,
        TX_HASH,
      )

      expect(result.found).toBe(true)
      expect(result.row).toBeNull()
      expect(result.notRefundable).toBe(true)
    })

    it('refunds a row with remaining bytes and stays idempotent on retry', async () => {
      const id = await createBatch({
        intentId: 'refund-unused',
        uploadOriginal: 1000n,
        uploadRemaining: 400n,
        expiresAt: pastDate,
      })

      const first = await purchasedCreditsRepository.markAsRefunded(id, TX_HASH)
      expect(first.found).toBe(true)
      expect(first.row).not.toBeNull()
      expect(first.row?.uploadBytesRemaining).toBe(0n)
      expect(first.row?.refundTxHash).toBe(TX_HASH)

      // Retry: remaining is now 0 because of the refund itself — must be an
      // already-refunded no-op, NOT notRefundable.
      const retry = await purchasedCreditsRepository.markAsRefunded(id, TX_HASH)
      expect(retry.found).toBe(true)
      expect(retry.row).toBeNull()
      expect(retry.notRefundable).toBeUndefined()
    })
  })

  describe('markManyAsRefunded', () => {
    it('rejects the whole combined refund when any batch is fully depleted', async () => {
      const refundableId = await createBatch({
        intentId: 'combined-unused',
        uploadOriginal: 1000n,
        uploadRemaining: 500n,
        expiresAt: pastDate,
      })
      const depletedId = await createBatch({
        intentId: 'combined-depleted',
        uploadOriginal: 1000n,
        uploadRemaining: 0n,
        expiresAt: pastDate,
      })

      const result = await purchasedCreditsRepository.markManyAsRefunded(
        [refundableId, depletedId],
        TX_HASH,
      )

      expect(result.nonRefundableIds).toEqual([depletedId])
      expect(result.refundedRows).toHaveLength(0)
      // All-or-nothing: the refundable row must not have been updated.
      const db = await getDatabase()
      const check = await db.query<{ refunded_at: Date | null }>(
        'SELECT refunded_at FROM purchased_credits WHERE id = $1',
        [refundableId],
      )
      expect(check.rows[0].refunded_at).toBeNull()
    })

    it('refunds AI3 and USDC purchases together for the same wallet and account', async () => {
      // Both purchases are refunded in AI3 with one transfer to this wallet.
      const WALLET = `0x${'b'.repeat(40)}`
      const ai3Id = await createBatch({
        intentId: 'combined-ai3',
        uploadOriginal: 1000n,
        uploadRemaining: 1000n,
        expiresAt: pastDate,
        fromAddress: WALLET,
      })
      const usdcId = await createBatch({
        intentId: 'combined-usdc',
        uploadOriginal: 1000n,
        uploadRemaining: 1000n,
        expiresAt: pastDate,
        paymentMethod: PaymentMethod.USDC_ETH,
        fromAddress: WALLET,
      })

      const result = await purchasedCreditsRepository.markManyAsRefunded(
        [ai3Id, usdcId],
        TX_HASH,
      )

      expect(result.accountIds).toHaveLength(1)
      expect(result.walletAddresses).toEqual([WALLET])
      expect(result.refundedRows).toHaveLength(2)
      expect(
        result.refundedRows.every((row) => row.refundTxHash === TX_HASH),
      ).toBe(true)
      expect(
        result.refundedRows.every((row) => row.uploadBytesRemaining === 0n),
      ).toBe(true)

      const db = await getDatabase()
      const check = await db.query<{ refunded_at: Date | null }>(
        'SELECT refunded_at FROM purchased_credits WHERE id = ANY($1::uuid[])',
        [[ai3Id, usdcId]],
      )
      expect(check.rows.every((r) => r.refunded_at !== null)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------
  // Admin purchase history: every field a refund is sized and sent from has
  // to survive the join, for both assets. A USDC purchase carries no AI3
  // payment_amount at all, so a row that only reports that column reads as
  // "nothing was paid".
  // ---------------------------------------------------------------------

  describe('getByUserPublicId', () => {
    const USER = 'user-purchase-history'
    const AI3_WALLET = `0x${'c'.repeat(40)}`
    const USDC_WALLET = `0x${'d'.repeat(40)}`

    it('returns the payment asset and its amounts for AI3 and USDC purchases', async () => {
      await createBatch({
        intentId: 'history-ai3',
        uploadOriginal: 1000n,
        uploadRemaining: 1000n,
        expiresAt: futureDate,
        userPublicId: USER,
        paymentAmount: 1_000_000n,
        fromAddress: AI3_WALLET,
      })
      await createBatch({
        intentId: 'history-usdc',
        uploadOriginal: 2000n,
        uploadRemaining: 2000n,
        expiresAt: futureDate,
        userPublicId: USER,
        paymentMethod: PaymentMethod.USDC_ETH,
        tokenAmount: 12_500_000n,
        quotedTokenAmount: 12_500_000n,
        quotedAi3Shannons: 2_000_000_000_000_000_000_000n,
        fromAddress: USDC_WALLET,
      })

      const rows = await purchasedCreditsRepository.getByUserPublicId(USER)
      const ai3 = rows.find((r) => r.intentId === 'history-ai3')
      const usdc = rows.find((r) => r.intentId === 'history-usdc')

      expect(ai3?.paymentMethod).toBe(PaymentMethod.AI3_NATIVE)
      expect(ai3?.paymentAmount).toBe(1_000_000n)
      expect(ai3?.tokenAmount).toBeNull()
      expect(ai3?.fromAddress).toBe(AI3_WALLET)

      expect(usdc?.paymentMethod).toBe(PaymentMethod.USDC_ETH)
      // The AI3 column is empty on this row by design — the amount paid is
      // the token amount, and the quote pair is the rate it was paid at.
      expect(usdc?.paymentAmount).toBeNull()
      expect(usdc?.tokenAmount).toBe(12_500_000n)
      expect(usdc?.quotedTokenAmount).toBe(12_500_000n)
      expect(usdc?.quotedAi3Shannons).toBe(2_000_000_000_000_000_000_000n)
      expect(usdc?.fromAddress).toBe(USDC_WALLET)
    })
  })
})
