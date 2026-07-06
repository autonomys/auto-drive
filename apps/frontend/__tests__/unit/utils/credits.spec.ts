import { isMibOverCap, isPackageOverCap, daysUntilExpiry, sumExpiringUploadBytes, getBatchStatus, isBatchRefundable } from '../../../src/utils/credits'

// ---------------------------------------------------------------------------
// isMibOverCap (shared helper used by both package and custom-amount flows)
// ---------------------------------------------------------------------------

describe('isMibOverCap', () => {
  it('returns false when maxPurchasableBytes is null', () => {
    expect(isMibOverCap(100, null)).toBe(false)
  })

  it('returns false when mib is 0', () => {
    expect(isMibOverCap(0, BigInt(1024 * 1024))).toBe(false)
  })

  it('returns false when mib is negative', () => {
    expect(isMibOverCap(-5, BigInt(1024 * 1024))).toBe(false)
  })

  it('returns true when maxPurchasableBytes is 0n', () => {
    expect(isMibOverCap(1, 0n)).toBe(true)
  })

  it('returns false when requested bytes fit within the cap', () => {
    const cap = BigInt(10 * 1024 * 1024)
    expect(isMibOverCap(5, cap)).toBe(false)
  })

  it('returns false when requested bytes exactly equal the cap', () => {
    const cap = BigInt(10 * 1024 * 1024)
    expect(isMibOverCap(10, cap)).toBe(false)
  })

  it('returns true when requested bytes exceed the cap by 1 byte', () => {
    const cap = BigInt(10 * 1024 * 1024) - 1n
    expect(isMibOverCap(10, cap)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isPackageOverCap
// ---------------------------------------------------------------------------

describe('isPackageOverCap', () => {
  it('returns false when maxPurchasableBytes is null (cap not loaded)', () => {
    expect(isPackageOverCap(100, null)).toBe(false)
  })

  it('returns false when creditsInMB is undefined', () => {
    expect(isPackageOverCap(undefined, 1000n)).toBe(false)
  })

  it('returns false when package fits within the remaining cap', () => {
    // 10 MiB package, 20 MiB remaining cap
    const maxBytes = BigInt(20 * 1024 * 1024)
    expect(isPackageOverCap(10, maxBytes)).toBe(false)
  })

  it('returns false when package exactly equals the remaining cap', () => {
    const maxBytes = BigInt(10 * 1024 * 1024)
    expect(isPackageOverCap(10, maxBytes)).toBe(false)
  })

  it('returns true when package exceeds the remaining cap by 1 byte', () => {
    // cap is 1 byte short of 10 MiB
    const maxBytes = BigInt(10 * 1024 * 1024) - 1n
    expect(isPackageOverCap(10, maxBytes)).toBe(true)
  })

  it('returns true when the remaining cap is zero', () => {
    expect(isPackageOverCap(10, 0n)).toBe(true)
  })

  it('handles large enterprise package (1 GiB)', () => {
    // 500 MiB remaining — 1 GiB package should be over cap
    const maxBytes = BigInt(500 * 1024 * 1024)
    expect(isPackageOverCap(1024, maxBytes)).toBe(true)
  })

  it('handles large enterprise package within generous cap', () => {
    // 2 GiB remaining — 1 GiB package should fit
    const maxBytes = BigInt(2 * 1024 * 1024 * 1024)
    expect(isPackageOverCap(1024, maxBytes)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// daysUntilExpiry
// ---------------------------------------------------------------------------

describe('daysUntilExpiry', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns null when expiresAt is null', () => {
    expect(daysUntilExpiry(null)).toBeNull()
  })

  it('returns 1 for a date that expires in exactly 1 day', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    jest.setSystemTime(now)
    const expiresAt = new Date('2026-01-02T00:00:00Z')
    expect(daysUntilExpiry(expiresAt)).toBe(1)
  })

  it('rounds down partial days so credits expiring today show 0', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    jest.setSystemTime(now)
    // 1.5 days → floor → 1
    const expiresAt = new Date('2026-01-02T12:00:00Z')
    expect(daysUntilExpiry(expiresAt)).toBe(1)
  })

  it('returns 0 when credits expire later today (< 1 whole day remaining)', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    jest.setSystemTime(now)
    // 0.5 days → floor → 0
    const expiresAt = new Date('2026-01-01T12:00:00Z')
    expect(daysUntilExpiry(expiresAt)).toBe(0)
  })

  it('returns 0 for a past expiry date (clamped)', () => {
    const now = new Date('2026-01-05T00:00:00Z')
    jest.setSystemTime(now)
    const expiresAt = new Date('2026-01-01T00:00:00Z')
    expect(daysUntilExpiry(expiresAt)).toBe(0)
  })

  it('returns 30 when expiry is exactly 30 days away', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    jest.setSystemTime(now)
    const expiresAt = new Date('2026-01-31T00:00:00Z')
    expect(daysUntilExpiry(expiresAt)).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// sumExpiringUploadBytes
// ---------------------------------------------------------------------------

describe('sumExpiringUploadBytes', () => {
  it('returns 0n for an empty array', () => {
    expect(sumExpiringUploadBytes([])).toBe(0n)
  })

  it('returns the correct sum for a single batch', () => {
    const batches = [{ uploadBytesRemaining: '1048576' }] // 1 MiB
    expect(sumExpiringUploadBytes(batches)).toBe(1048576n)
  })

  it('sums multiple batches correctly', () => {
    const batches = [
      { uploadBytesRemaining: '1048576' },   // 1 MiB
      { uploadBytesRemaining: '2097152' },   // 2 MiB
      { uploadBytesRemaining: '5242880' },   // 5 MiB
    ]
    expect(sumExpiringUploadBytes(batches)).toBe(8388608n) // 8 MiB total
  })

  it('handles large byte values without overflow', () => {
    // 1 GiB each, 3 batches → 3 GiB total
    const oneGiB = BigInt(1024 * 1024 * 1024)
    const batches = [
      { uploadBytesRemaining: oneGiB.toString() },
      { uploadBytesRemaining: oneGiB.toString() },
      { uploadBytesRemaining: oneGiB.toString() },
    ]
    expect(sumExpiringUploadBytes(batches)).toBe(oneGiB * 3n)
  })
})

// ---------------------------------------------------------------------------
// getBatchStatus
// ---------------------------------------------------------------------------

describe('getBatchStatus', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-01T00:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const makeBatch = (overrides: Partial<{ expired: boolean; uploadBytesRemaining: string; downloadBytesRemaining: string; expiresAt: string }> = {}) => ({
    expired: false,
    uploadBytesRemaining: '1048576',
    downloadBytesRemaining: '0',
    expiresAt: '2026-12-01T00:00:00Z',
    ...overrides,
  })

  it('returns "expired" when batch.expired is true', () => {
    expect(getBatchStatus(makeBatch({ expired: true }))).toBe('expired')
  })

  it('returns "depleted" when both upload and download remaining are zero', () => {
    expect(getBatchStatus(makeBatch({ uploadBytesRemaining: '0' }))).toBe('depleted')
  })

  it('is NOT depleted while download bytes remain — matches isBatchRefundable', () => {
    expect(getBatchStatus(makeBatch({ uploadBytesRemaining: '0', downloadBytesRemaining: '512' }))).toBe('active')
  })

  it('an expired batch with only download bytes left is "expired", not "depleted"', () => {
    expect(getBatchStatus(makeBatch({ expired: true, uploadBytesRemaining: '0', downloadBytesRemaining: '512' }))).toBe('expired')
  })

  it('returns "expiring" when the batch expires within 30 days', () => {
    // 15 days from "now" (2026-06-01)
    expect(getBatchStatus(makeBatch({ expiresAt: '2026-06-16T00:00:00Z' }))).toBe('expiring')
  })

  it('returns "expiring" when the batch expires in exactly 30 days', () => {
    expect(getBatchStatus(makeBatch({ expiresAt: '2026-07-01T00:00:00Z' }))).toBe('expiring')
  })

  it('returns "active" when the batch expires in more than 30 days', () => {
    expect(getBatchStatus(makeBatch({ expiresAt: '2026-07-02T00:00:00Z' }))).toBe('active')
  })

  it('prioritises "depleted" over "expired" (fully used batches owe no refund)', () => {
    expect(getBatchStatus(makeBatch({ expired: true, uploadBytesRemaining: '0' }))).toBe('depleted')
  })

  it('returns "expired" when the batch is expired with bytes remaining', () => {
    expect(getBatchStatus(makeBatch({ expired: true, uploadBytesRemaining: '1048576' }))).toBe('expired')
  })

  it('prioritises "depleted" over "expiring"', () => {
    expect(getBatchStatus(makeBatch({ uploadBytesRemaining: '0', expiresAt: '2026-06-10T00:00:00Z' }))).toBe('depleted')
  })
})

// ---------------------------------------------------------------------------
// isBatchRefundable
// ---------------------------------------------------------------------------

describe('isBatchRefundable', () => {
  const makeBatch = (
    overrides: Partial<{
      refundedAt: string | null
      uploadBytesRemaining: string
      downloadBytesRemaining: string
    }> = {},
  ) => ({
    refundedAt: null,
    uploadBytesRemaining: '1048576',
    downloadBytesRemaining: '0',
    ...overrides,
  })

  it('returns true for a non-refunded batch with upload bytes remaining', () => {
    expect(isBatchRefundable(makeBatch())).toBe(true)
  })

  it('returns true when only download bytes remain', () => {
    expect(isBatchRefundable(makeBatch({ uploadBytesRemaining: '0', downloadBytesRemaining: '512' }))).toBe(true)
  })

  it('returns false when the batch is already refunded', () => {
    expect(isBatchRefundable(makeBatch({ refundedAt: '2026-06-01T00:00:00Z' }))).toBe(false)
  })

  it('returns false for a fully depleted batch — no refund is owed', () => {
    expect(isBatchRefundable(makeBatch({ uploadBytesRemaining: '0', downloadBytesRemaining: '0' }))).toBe(false)
  })
})
