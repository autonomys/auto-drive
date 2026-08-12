import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { intentMispaymentsRepository } from '../../../src/infrastructure/repositories/users/intentMispayments.js'
import { IntentMispaymentReason, PaymentMethod } from '@auto-drive/models'
import { dbMigration } from '../../utils/dbMigrate.js'

// Exercises the table added by 20260812000000-intent-mispayments against the
// migrated TestContainers Postgres (requires Docker), like the other repository
// specs.
describe('Intent Mispayments Repository', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  it('round-trips an asset mismatch, keeping amounts as bigints', async () => {
    const recorded = await intentMispaymentsRepository.record({
      intentId: '0xusdc-intent',
      reason: IntentMispaymentReason.ASSET_MISMATCH,
      expectedPaymentMethod: PaymentMethod.USDC_ETH,
      // An AI3 amount against a USDC intent — wide enough to prove
      // numeric(78,0) carries it without going through a float.
      paymentAmount: 5_000_000_000_000_000_000n,
      fromAddress: '0xpayer',
      txHash: '0xdeadbeef',
    })

    expect(recorded).not.toBeNull()
    expect(recorded!.reason).toBe(IntentMispaymentReason.ASSET_MISMATCH)
    expect(recorded!.expectedPaymentMethod).toBe(PaymentMethod.USDC_ETH)
    expect(recorded!.paymentAmount).toBe(5_000_000_000_000_000_000n)
    expect(typeof recorded!.paymentAmount).toBe('bigint')
    // Exactly one amount is set, and which one is the evidence of what happened.
    expect(recorded!.tokenAmount).toBeUndefined()
    expect(recorded!.createdAt).toBeInstanceOf(Date)
  })

  it('records an unknown intent id, which has no expected asset', async () => {
    const recorded = await intentMispaymentsRepository.record({
      intentId: '0xnosuchintent',
      reason: IntentMispaymentReason.UNKNOWN_INTENT,
      tokenAmount: 3_045_000n,
      txHash: '0xfeedface',
    })

    expect(recorded!.reason).toBe(IntentMispaymentReason.UNKNOWN_INTENT)
    // No intent row exists, so there is no asset it was supposed to be.
    expect(recorded!.expectedPaymentMethod).toBeUndefined()
    expect(recorded!.tokenAmount).toBe(3_045_000n)
  })

  it('does not duplicate a mispayment the watcher re-delivers', async () => {
    // Reorgs re-emit events and the startup sweep replays every PENDING intent
    // with a tx_hash. A second sighting of one transfer must not become a second
    // row — an admin queue that grows on every restart is one nobody reads.
    const first = await intentMispaymentsRepository.record({
      intentId: '0xreplayed',
      reason: IntentMispaymentReason.ASSET_MISMATCH,
      expectedPaymentMethod: PaymentMethod.USDC_ETH,
      paymentAmount: 1n,
      txHash: '0xsamehash',
    })
    const second = await intentMispaymentsRepository.record({
      intentId: '0xreplayed',
      reason: IntentMispaymentReason.ASSET_MISMATCH,
      expectedPaymentMethod: PaymentMethod.USDC_ETH,
      paymentAmount: 1n,
      txHash: '0xsamehash',
    })

    expect(first).not.toBeNull()
    // Null is the ON CONFLICT path: already on file.
    expect(second).toBeNull()

    const listed = await intentMispaymentsRepository.list()
    expect(listed.filter((m) => m.intentId === '0xreplayed')).toHaveLength(1)
  })

  it('keeps one transaction paying two different intents apart', async () => {
    // The constraint is per (transaction, intent), not per transaction: one tx
    // can carry payments for more than one intent id.
    await intentMispaymentsRepository.record({
      intentId: '0xintent-a',
      reason: IntentMispaymentReason.UNKNOWN_INTENT,
      paymentAmount: 1n,
      txHash: '0xmultipay',
    })
    await intentMispaymentsRepository.record({
      intentId: '0xintent-b',
      reason: IntentMispaymentReason.UNKNOWN_INTENT,
      paymentAmount: 2n,
      txHash: '0xmultipay',
    })

    const listed = await intentMispaymentsRepository.list()
    expect(listed.filter((m) => m.txHash === '0xmultipay')).toHaveLength(2)
  })

  it('lists newest first', async () => {
    const listed = await intentMispaymentsRepository.list()
    expect(listed.length).toBeGreaterThan(1)
    for (let i = 1; i < listed.length; i++) {
      expect(listed[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        listed[i].createdAt.getTime(),
      )
    }
  })
})
