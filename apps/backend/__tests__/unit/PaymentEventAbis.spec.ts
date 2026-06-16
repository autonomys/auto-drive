import { describe, it, expect } from '@jest/globals'
import {
  intentPaymentReceivedAbi,
  intentTokenPaymentReceivedAbi,
  IntentSchema,
  IntentStatus,
  PaymentMethod,
  USD_RATE_SCALE,
} from '@auto-drive/models'

// These ABIs are shared (backend watcher, future contract, frontend) so their
// exact shape — event name and which inputs are `indexed` — is a contract that
// must not drift silently. A flipped `indexed` flag or a dropped field would
// break viem log decoding at runtime without a type error.
describe('payment event ABIs (@auto-drive/models)', () => {
  const indexedNames = (inputs: readonly { name: string; indexed: boolean }[]) =>
    inputs.filter((i) => i.indexed).map((i) => i.name)

  const fieldShape = (inputs: readonly { name: string; type: string }[]) =>
    inputs.map((i) => [i.name, i.type])

  describe('intentPaymentReceivedAbi (native AI3)', () => {
    const [event] = intentPaymentReceivedAbi

    it('declares the IntentPaymentReceived event', () => {
      expect(event.type).toBe('event')
      expect(event.name).toBe('IntentPaymentReceived')
    })

    it('indexes only intentId', () => {
      expect(indexedNames(event.inputs)).toEqual(['intentId'])
    })

    it('has the expected field shape and order', () => {
      expect(fieldShape(event.inputs)).toEqual([
        ['intentId', 'bytes32'],
        ['paymentAmount', 'uint256'],
      ])
    })
  })

  describe('intentTokenPaymentReceivedAbi (USDC / ERC20)', () => {
    const [event] = intentTokenPaymentReceivedAbi

    it('declares the IntentTokenPaymentReceived event', () => {
      expect(event.type).toBe('event')
      expect(event.name).toBe('IntentTokenPaymentReceived')
    })

    it('indexes intentId and payer', () => {
      // payer must be present and indexed: ERC20 payments can be relayed, so
      // the payer cannot be recovered from receipt.from and has to travel in
      // the event itself.
      expect(indexedNames(event.inputs)).toEqual(['intentId', 'payer'])
    })

    it('has the expected field shape and order', () => {
      expect(fieldShape(event.inputs)).toEqual([
        ['intentId', 'bytes32'],
        ['token', 'address'],
        ['amount', 'uint256'],
        ['payer', 'address'],
      ])
    })
  })
})

describe('IntentSchema payment fields', () => {
  const baseIntent = {
    id: 'intent-1',
    userPublicId: 'user-1',
    status: IntentStatus.PENDING,
    shannonsPerByte: 1000n,
  }

  it('parses a legacy AI3 intent with no payment_method or token fields', () => {
    const parsed = IntentSchema.parse(baseIntent)
    // Back-compat: rows created before this epic carry none of the new fields.
    expect(parsed.paymentMethod).toBeUndefined()
    expect(parsed.tokenAmount).toBeUndefined()
    expect(parsed.quotedTokenAmount).toBeUndefined()
    expect(parsed.usdRateAtCreation).toBeUndefined()
  })

  it('parses a USDC intent with method, token amounts and locked rate', () => {
    const parsed = IntentSchema.parse({
      ...baseIntent,
      paymentMethod: PaymentMethod.USDC_ETH,
      tokenAmount: 5_000_000n, // 5 USDC (6 decimals)
      quotedTokenAmount: 5_000_000n,
      usdRateAtCreation: 6_400_000_000_000_000n, // 0.0064 USD/AI3 * 1e18
    })
    expect(parsed.paymentMethod).toBe(PaymentMethod.USDC_ETH)
    expect(parsed.tokenAmount).toBe(5_000_000n)
    expect(typeof parsed.usdRateAtCreation).toBe('bigint')
  })

  it('rejects an unknown payment method', () => {
    expect(() =>
      IntentSchema.parse({ ...baseIntent, paymentMethod: 'paypal' }),
    ).toThrow()
  })

  it('locks USD_RATE_SCALE to 1e18 (downstream quote math depends on it)', () => {
    expect(USD_RATE_SCALE).toBe(10n ** 18n)
  })
})
