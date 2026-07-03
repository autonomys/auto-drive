import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { intentsRepository } from '../../../src/infrastructure/repositories/users/intents.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { IntentStatus } from '@auto-drive/models'
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
  }) => {
    await intentsRepository.createIntent({
      id: params.intentId,
      userPublicId: `user-${params.intentId}`,
      status: IntentStatus.COMPLETED,
      shannonsPerByte: 1000n,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    })

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
})
