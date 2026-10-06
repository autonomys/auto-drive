import { toDateTimeLocalValue } from '../../../src/utils/time'

describe('toDateTimeLocalValue', () => {
  // A datetime-local input reads its value back as local time, so this only
  // catches a UTC formatting regression when run outside UTC.
  it.each([
    '2026-11-10T12:00:00.000Z',
    '2026-07-01T23:30:00.000Z',
    '2026-03-29T00:45:00.000Z',
  ])('round-trips %s through a datetime-local input unchanged', (stored) => {
    const formValue = toDateTimeLocalValue(new Date(stored))
    expect(formValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(new Date(formValue).toISOString()).toBe(stored)
  })

  it('accepts the ISO string the API returns in place of a Date', () => {
    const stored = '2026-11-10T12:00:00.000Z'
    expect(toDateTimeLocalValue(stored)).toBe(
      toDateTimeLocalValue(new Date(stored)),
    )
  })
})
