import { isPackageOverCap, daysUntilExpiry, sumExpiringUploadBytes, getBatchStatus } from '../../../src/utils/credits'

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
    // 10 MB package, 20 MB remaining cap
    const maxBytes = BigInt(20 * 1024 * 1024)
    expect(isPackageOverCap(10, maxBytes)).toBe(false)
  })

  it('returns false when package exactly equals the remaining cap', () => {
    const maxBytes = BigInt(10 * 1024 * 1024)
    expect(isPackageOverCap(10, maxBytes)).toBe(false)
  })

  it('returns true when package exceeds the remaining cap by 1 byte', () => {
    // cap is 1 byte short of 10 MB
    const maxBytes = BigInt(10 * 1024 * 1024) - 1n
    expect(isPackageOverCap(10, maxBytes)).toBe(true)
  })

  it('returns true when the remaining cap is zero', () => {
    expect(isPackageOverCap(10, 0n)).toBe(true)
  })

  it('handles large enterprise package (1 GB)', () => {
    // 500 MB remaining — 1 GB package should be over cap
    const maxBytes = BigInt(500 * 1024 * 1024)
    expect(isPackageOverCap(1024, maxBytes)).toBe(true)
  })

  it('handles large enterprise package within generous cap', () => {
    // 2 GB remaining — 1 GB package should fit
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
    const batches = [{ uploadBytesRemaining: '1048576' }] // 1 MB
    expect(sumExpiringUploadBytes(batches)).toBe(1048576n)
  })

  it('sums multiple batches correctly', () => {
    const batches = [
      { uploadBytesRemaining: '1048576' },   // 1 MB
      { uploadBytesRemaining: '2097152' },   // 2 MB
      { uploadBytesRemaining: '5242880' },   // 5 MB
    ]
    expect(sumExpiringUploadBytes(batches)).toBe(8388608n) // 8 MB total
  })

  it('handles large byte values without overflow', () => {
    // 1 GB each, 3 batches → 3 GB total
    const oneMiB = BigInt(1024 * 1024 * 1024)
    const batches = [
      { uploadBytesRemaining: oneMiB.toString() },
      { uploadBytesRemaining: oneMiB.toString() },
      { uploadBytesRemaining: oneMiB.toString() },
    ]
    expect(sumExpiringUploadBytes(batches)).toBe(oneMiB * 3n)
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

  const makeBatch = (overrides: Partial<{ expired: boolean; uploadBytesRemaining: string; expiresAt: string }> = {}) => ({
    expired: false,
    uploadBytesRemaining: '1048576',
    expiresAt: '2026-12-01T00:00:00Z',
    ...overrides,
  })

  it('returns "expired" when batch.expired is true', () => {
    expect(getBatchStatus(makeBatch({ expired: true }))).toBe('expired')
  })

  it('returns "depleted" when uploadBytesRemaining is zero', () => {
    expect(getBatchStatus(makeBatch({ uploadBytesRemaining: '0' }))).toBe('depleted')
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

  it('prioritises "expired" over "depleted"', () => {
    expect(getBatchStatus(makeBatch({ expired: true, uploadBytesRemaining: '0' }))).toBe('expired')
  })

  it('prioritises "depleted" over "expiring"', () => {
    expect(getBatchStatus(makeBatch({ uploadBytesRemaining: '0', expiresAt: '2026-06-10T00:00:00Z' }))).toBe('depleted')
  })
})
