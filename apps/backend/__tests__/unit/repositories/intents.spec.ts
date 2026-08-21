import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { intentsRepository } from '../../../src/infrastructure/repositories/users/intents.js'
import { Intent, IntentStatus, PaymentMethod } from '@auto-drive/models'
import { dbMigration } from '../../utils/dbMigrate.js'

// Exercises the payment-asset columns added by 20260616000000-intent-payment-fields
// together with the repository read/write mapping. Runs against the migrated
// TestContainers Postgres (requires Docker), like the other repository specs.
describe('Intents Repository — payment fields', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  const baseIntent = (id: string): Intent => ({
    id,
    userPublicId: `user-${id}`,
    status: IntentStatus.PENDING,
    shannonsPerByte: 1000n,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
  })

  it('defaults payment_method to ai3_native and leaves token fields NULL', async () => {
    const created = await intentsRepository.createIntent(baseIntent('ai3-1'))
    expect(created.paymentMethod).toBe(PaymentMethod.AI3_NATIVE)
    expect(created.tokenAmount).toBeUndefined()
    expect(created.quotedTokenAmount).toBeUndefined()
    expect(created.quotedAi3Shannons).toBeUndefined()
    expect(created.usdRateAtCreation).toBeUndefined()

    const fetched = await intentsRepository.getById('ai3-1')
    expect(fetched?.paymentMethod).toBe(PaymentMethod.AI3_NATIVE)
    expect(fetched?.tokenAmount).toBeUndefined()
    expect(fetched?.quotedAi3Shannons).toBeUndefined()
  })

  it('round-trips a USDC intent with token amounts and locked rate as bigints', async () => {
    const usdcIntent: Intent = {
      ...baseIntent('usdc-1'),
      paymentMethod: PaymentMethod.USDC_ETH,
      tokenAmount: 5_000_000n, // 5 USDC (6 decimals)
      quotedTokenAmount: 5_000_000n,
      // The AI3 the quote was priced for. Wide enough to prove numeric(78,0)
      // carries it without going through a float.
      quotedAi3Shannons: 45_312_499_999_999_996_723_200n,
      usdRateAtCreation: 6_400_000_000_000_000n, // 0.0064 USD/AI3 * 1e18
    }
    await intentsRepository.createIntent(usdcIntent)

    const fetched = await intentsRepository.getById('usdc-1')
    expect(fetched?.paymentMethod).toBe(PaymentMethod.USDC_ETH)
    expect(fetched?.tokenAmount).toBe(5_000_000n)
    expect(fetched?.quotedTokenAmount).toBe(5_000_000n)
    expect(fetched?.quotedAi3Shannons).toBe(45_312_499_999_999_996_723_200n)
    expect(typeof fetched?.quotedAi3Shannons).toBe('bigint')
    expect(fetched?.usdRateAtCreation).toBe(6_400_000_000_000_000n)
    expect(typeof fetched?.usdRateAtCreation).toBe('bigint')
  })

  it('preserves payment fields across an update that spreads the loaded intent', async () => {
    const usdcIntent: Intent = {
      ...baseIntent('usdc-2'),
      paymentMethod: PaymentMethod.USDC_ETH,
      tokenAmount: 1_000_000n,
      quotedTokenAmount: 1_000_000n,
      quotedAi3Shannons: 3_000_000_000_000n,
      usdRateAtCreation: 6_400_000_000_000_000n,
    }
    await intentsRepository.createIntent(usdcIntent)

    const loaded = await intentsRepository.getById('usdc-2')
    expect(loaded).not.toBeNull()

    // Mirrors how the use cases update intents: spread the loaded row, override
    // only the changed field. The token/method fields must survive untouched.
    //
    // This is the test that catches the trap in updateIntent: the statement
    // rewrites the full column list, so a column added to the table but missed
    // there is silently nulled on the first status transition — invisible until
    // credits come out wrong, because the intent still looks complete at
    // creation.
    await intentsRepository.updateIntent({
      ...(loaded as Intent),
      status: IntentStatus.CONFIRMED,
      paymentAmount: 5_000_000n,
    })

    const updated = await intentsRepository.getById('usdc-2')
    expect(updated?.status).toBe(IntentStatus.CONFIRMED)
    expect(updated?.paymentMethod).toBe(PaymentMethod.USDC_ETH)
    expect(updated?.tokenAmount).toBe(1_000_000n)
    expect(updated?.quotedTokenAmount).toBe(1_000_000n)
    expect(updated?.quotedAi3Shannons).toBe(3_000_000_000_000n)
    expect(updated?.usdRateAtCreation).toBe(6_400_000_000_000_000n)
  })

  it('keeps the quote pair exact across a full create/update/read cycle', async () => {
    // Not a duplicate of the round-trip above: this asserts the two numbers still
    // reproduce the requested size after a database round trip, which is the
    // property the credit conversion depends on. numeric(78,0) mapped through a
    // float anywhere in that path would break it while both columns still looked
    // populated.
    const requestedBytes = 1_073_741_824n
    const shannonsPerByte = 422_005_541_622n
    const quotedAi3Shannons = requestedBytes * shannonsPerByte

    await intentsRepository.createIntent({
      ...baseIntent('usdc-3'),
      shannonsPerByte,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount: 3_045_000_000n,
      quotedAi3Shannons,
      usdRateAtCreation: 6_400_000_000_000_000n,
    })

    const loaded = await intentsRepository.getById('usdc-3')
    await intentsRepository.updateIntent({
      ...(loaded as Intent),
      status: IntentStatus.CONFIRMED,
      tokenAmount: 3_045_000_000n, // paid exactly what was quoted
    })

    const confirmed = (await intentsRepository.getById('usdc-3')) as Intent
    const shannons =
      (confirmed.tokenAmount! * confirmed.quotedAi3Shannons!) /
      confirmed.quotedTokenAmount!
    expect(shannons / confirmed.shannonsPerByte).toBe(requestedBytes)
  })

  it('confirms a PENDING intent once, and refuses the second attempt', async () => {
    // The conditional transition is what makes two payments in one transaction
    // distinguishable: whichever loses the UPDATE gets null back and files the
    // payment instead of overwriting the one that won.
    const requestedBytes = 1_000n
    const shannonsPerByte = 422_005_541_622n
    await intentsRepository.createIntent({
      ...baseIntent('confirm-race'),
      shannonsPerByte,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount: 3_045_000n,
      quotedAi3Shannons: requestedBytes * shannonsPerByte,
      usdRateAtCreation: 6_400_000_000_000_000n,
    })

    const first = await intentsRepository.confirmIntentIfPending({
      id: 'confirm-race',
      tokenAmount: 3_045_000n,
      fromAddress: '0xpayer',
      txHash: '0xwinner',
    })
    const second = await intentsRepository.confirmIntentIfPending({
      id: 'confirm-race',
      tokenAmount: 9_999_999n,
      fromAddress: '0xother',
      txHash: '0xloser',
    })

    expect(first).not.toBeNull()
    expect(first!.status).toBe(IntentStatus.CONFIRMED)
    expect(first!.tokenAmount).toBe(3_045_000n)
    // Null is how the caller learns it raced.
    expect(second).toBeNull()

    // The loser must not have moved anything.
    const after = (await intentsRepository.getById('confirm-race')) as Intent
    expect(after.tokenAmount).toBe(3_045_000n)
    expect(after.txHash).toBe('0xwinner')
    // The statement never names the quote columns, so nothing it does can null
    // the numbers credits are derived from.
    expect(after.quotedTokenAmount).toBe(3_045_000n)
    expect(after.quotedAi3Shannons).toBe(requestedBytes * shannonsPerByte)
    expect(after.shannonsPerByte).toBe(shannonsPerByte)
  })

  it('selects expired rows by tx_hash and the grace window', async () => {
    // The grace is what stops a tx_hash from exempting a row from expiry
    // permanently. Worth exercising against real Postgres rather than a spy: the
    // window is applied as an interval built from a query parameter, so the whole
    // behaviour lives in SQL no unit test can reach.
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000)

    const withTxHash = async (id: string, expiresAt: Date, txHash: string) => {
      const created = await intentsRepository.createIntent({
        ...baseIntent(id),
        expiresAt,
      })
      await intentsRepository.updateIntent({ ...created, txHash })
    }

    // Past its window and never paid — expired before this change too.
    await intentsRepository.createIntent({
      ...baseIntent('exp-unpaid'),
      expiresAt: minutesAgo(30),
    })
    // A transaction submitted moments ago: still being watched, and must be left
    // alone or a slow confirmation would expire out from under the payer.
    await withTxHash('exp-watched', minutesAgo(30), '0xrecent')
    // A hash that never resolved. Previously unreachable by cleanup forever.
    await withTxHash('exp-stranded', minutesAgo(60 * 48), '0xnever')
    // Window still open.
    await intentsRepository.createIntent({
      ...baseIntent('exp-live'),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })

    const graceMinutes = 1440
    const ids = (await intentsRepository.getExpiredPendingIntents(graceMinutes))
      .map((i) => i.id)
      .filter((id) => id.startsWith('exp-'))

    expect(ids.sort()).toEqual(['exp-stranded', 'exp-unpaid'])
  })
  // -------------------------------------------------------------------------
  // getPendingWithTxHash — the startup sweep, one chain at a time
  // -------------------------------------------------------------------------

  it('returns only the pending rows of the payment method asked for', async () => {
    await intentsRepository.createIntent({
      ...baseIntent('sweep-ai3'),
      txHash: '0xai3hash',
    })
    await intentsRepository.createIntent({
      ...baseIntent('sweep-usdc'),
      paymentMethod: PaymentMethod.USDC_ETH,
      txHash: '0xethhash',
    })
    // No hash: not orphaned, nothing to look up.
    await intentsRepository.createIntent(baseIntent('sweep-no-hash'))

    const ai3 = await intentsRepository.getPendingWithTxHash(
      PaymentMethod.AI3_NATIVE,
    )
    const usdc = await intentsRepository.getPendingWithTxHash(
      PaymentMethod.USDC_ETH,
    )

    // Each watcher can only resolve hashes from its own chain, so the sweep is
    // scoped the same way. Crossing them does not error — it waits out a
    // receipt timeout per row — which is why this is a filter and not a hint.
    // Containment rather than equality: earlier tests in this file leave their
    // own pending rows behind, and what matters here is that neither chain sees
    // the other's.
    expect(ai3.map((i) => i.id)).toContain('sweep-ai3')
    expect(ai3.map((i) => i.id)).not.toContain('sweep-usdc')
    expect(usdc.map((i) => i.id)).toEqual(['sweep-usdc'])
    expect(ai3.map((i) => i.id)).not.toContain('sweep-no-hash')
  })

  it('sweeps rows written before payment_method existed as AI3', async () => {
    // The column is NOT NULL with an 'ai3_native' default, so a row created
    // without one is indistinguishable from an explicit AI3 row — which is what
    // makes the default the thing that keeps legacy intents recoverable.
    const created = await intentsRepository.createIntent({
      ...baseIntent('sweep-legacy'),
      txHash: '0xlegacyhash',
    })
    expect(created.paymentMethod).toBe(PaymentMethod.AI3_NATIVE)

    const ai3 = await intentsRepository.getPendingWithTxHash(
      PaymentMethod.AI3_NATIVE,
    )
    expect(ai3.map((i) => i.id)).toContain('sweep-legacy')
  })
})
