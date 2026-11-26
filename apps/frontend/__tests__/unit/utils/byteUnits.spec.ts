import { amountToBytes, bytesToAmount } from '../../../src/utils/byteUnits'

const GB = 1024 ** 3

describe('amountToBytes', () => {
  it('counts MB, GB and TB in binary', () => {
    expect(amountToBytes('1', 'MB')).toBe(1024 ** 2)
    expect(amountToBytes('1.5', 'GB')).toBe(1.5 * GB)
    expect(amountToBytes('2', 'TB')).toBe(2 * 1024 ** 4)
    expect(amountToBytes(' 0 ', 'GB')).toBe(0)
  })

  it('refuses what is not an amount', () => {
    for (const amount of ['', ' ', 'abc', '-1', 'Infinity', '1e12']) {
      expect(amountToBytes(amount, 'TB')).toBeNull()
    }
  })
})

describe('bytesToAmount', () => {
  it('picks the largest unit that reads well', () => {
    expect(bytesToAmount(50 * GB)).toEqual({ amount: '50', unit: 'GB' })
    expect(bytesToAmount(2 * 1024 * GB)).toEqual({ amount: '2', unit: 'TB' })
    expect(bytesToAmount(512 * 1024 ** 2)).toEqual({ amount: '512', unit: 'MB' })
    expect(bytesToAmount(0)).toEqual({ amount: '0', unit: 'MB' })
  })

  it('round-trips every amount exactly', () => {
    for (const bytes of [0, 1, 1000, 5 * GB + 1, 1_000_000_000, 123 * GB]) {
      const { amount, unit } = bytesToAmount(bytes)
      expect(amountToBytes(amount, unit)).toBe(bytes)
    }
  })
})
