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
    expect(created.usdRateAtCreation).toBeUndefined()

    const fetched = await intentsRepository.getById('ai3-1')
    expect(fetched?.paymentMethod).toBe(PaymentMethod.AI3_NATIVE)
    expect(fetched?.tokenAmount).toBeUndefined()
  })

  it('round-trips a USDC intent with token amounts and locked rate as bigints', async () => {
    const usdcIntent: Intent = {
      ...baseIntent('usdc-1'),
      paymentMethod: PaymentMethod.USDC_ETH,
      tokenAmount: 5_000_000n, // 5 USDC (6 decimals)
      quotedTokenAmount: 5_000_000n,
      usdRateAtCreation: 6_400_000_000_000_000n, // 0.0064 USD/AI3 * 1e18
    }
    await intentsRepository.createIntent(usdcIntent)

    const fetched = await intentsRepository.getById('usdc-1')
    expect(fetched?.paymentMethod).toBe(PaymentMethod.USDC_ETH)
    expect(fetched?.tokenAmount).toBe(5_000_000n)
    expect(fetched?.quotedTokenAmount).toBe(5_000_000n)
    expect(fetched?.usdRateAtCreation).toBe(6_400_000_000_000_000n)
    expect(typeof fetched?.usdRateAtCreation).toBe('bigint')
  })

  it('preserves payment fields across an update that spreads the loaded intent', async () => {
    const usdcIntent: Intent = {
      ...baseIntent('usdc-2'),
      paymentMethod: PaymentMethod.USDC_ETH,
      tokenAmount: 1_000_000n,
      quotedTokenAmount: 1_000_000n,
      usdRateAtCreation: 6_400_000_000_000_000n,
    }
    await intentsRepository.createIntent(usdcIntent)

    const loaded = await intentsRepository.getById('usdc-2')
    expect(loaded).not.toBeNull()

    // Mirrors how the use cases update intents: spread the loaded row, override
    // only the changed field. The token/method fields must survive untouched.
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
    expect(updated?.usdRateAtCreation).toBe(6_400_000_000_000_000n)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // quoted_bytes (20260804000000-intent-quoted-bytes)
  // ──────────────────────────────────────────────────────────────────────────

  it('round-trips quotedBytes as a bigint', async () => {
    await intentsRepository.createIntent({
      ...baseIntent('qb-1'),
      quotedBytes: 1_073_741_824n, // 1 GiB
    })

    const fetched = await intentsRepository.getById('qb-1')
    expect(fetched?.quotedBytes).toBe(1_073_741_824n)
    expect(typeof fetched?.quotedBytes).toBe('bigint')
  })

  it('leaves quotedBytes undefined — not 0n — when created without a size', async () => {
    const created = await intentsRepository.createIntent(baseIntent('qb-2'))
    expect(created.quotedBytes).toBeUndefined()

    // A NULL column must not read back as 0n: "no size recorded" and "a size of
    // zero bytes" have to stay distinguishable, since #747 branches on presence.
    const fetched = await intentsRepository.getById('qb-2')
    expect(fetched?.quotedBytes).toBeUndefined()
  })

  it('round-trips a cap-sized quotedBytes through numeric(78,0)', async () => {
    // 100 GiB — the default per-user cap, and past the range where a float
    // round-trip would still be exact.
    await intentsRepository.createIntent({
      ...baseIntent('qb-3'),
      quotedBytes: 107_374_182_400n,
    })

    const fetched = await intentsRepository.getById('qb-3')
    expect(fetched?.quotedBytes).toBe(107_374_182_400n)
  })

  it('preserves quotedBytes across a status transition', async () => {
    // The trap this guards: updateIntent rewrites the full column list, so a
    // column present in the INSERT but missing from the UPDATE is silently
    // nulled by the first status change — invisible until credits are wrong.
    await intentsRepository.createIntent({
      ...baseIntent('qb-4'),
      quotedBytes: 4_096n,
    })

    const loaded = await intentsRepository.getById('qb-4')
    await intentsRepository.updateIntent({
      ...(loaded as Intent),
      status: IntentStatus.CONFIRMED,
      paymentAmount: 4_096_000n,
    })

    const updated = await intentsRepository.getById('qb-4')
    expect(updated?.status).toBe(IntentStatus.CONFIRMED)
    expect(updated?.quotedBytes).toBe(4_096n)
  })
})
