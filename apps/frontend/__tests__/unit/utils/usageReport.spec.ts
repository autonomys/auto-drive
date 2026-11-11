import { firstDayFrom, toUsageRange } from '../../../src/utils/usageReport';

describe('toUsageRange', () => {
  it('turns inclusive days into a [from, to) range', () => {
    expect(toUsageRange({ from: '2026-11-01', through: '2026-11-11' })).toEqual(
      { from: '2026-11-01', to: '2026-11-12' },
    );
  });

  it('rolls `to` over month and year ends', () => {
    expect(toUsageRange({ from: '2026-02-01', through: '2026-02-28' })).toEqual(
      { from: '2026-02-01', to: '2026-03-01' },
    );
    expect(toUsageRange({ from: '2026-12-01', through: '2026-12-31' })).toEqual(
      { from: '2026-12-01', to: '2027-01-01' },
    );
  });

  it('accepts a single day', () => {
    expect(toUsageRange({ from: '2026-11-11', through: '2026-11-11' })).toEqual(
      { from: '2026-11-11', to: '2026-11-12' },
    );
  });

  it('returns null when a day is missing or the days are out of order', () => {
    expect(toUsageRange({ from: '', through: '2026-11-11' })).toBeNull();
    expect(toUsageRange({ from: '2026-11-01', through: '' })).toBeNull();
    expect(
      toUsageRange({ from: '2026-11-11', through: '2026-11-01' }),
    ).toBeNull();
  });

  // A date input with no max lets a year segment take more than 4 digits.
  // '20261-11-11' sorts after '2026-11-01', so only the shape check stops it
  // from reaching `new Date`, which would throw and crash the page.
  it.each(['20261-11-11', '202611-11-11'])(
    'returns null for the over-long year %s instead of throwing',
    (through) => {
      expect(toUsageRange({ from: '2026-11-01', through })).toBeNull();
      expect(toUsageRange({ from: through, through: '2026-11-11' })).toBeNull();
    },
  );
});

describe('firstDayFrom', () => {
  it('keeps a day that starts exactly at the time', () => {
    expect(firstDayFrom('2026-11-10T00:00:00.000Z')).toBe('2026-11-10');
  });

  it('moves to the next day when the time is inside a day', () => {
    expect(firstDayFrom('2026-11-10T00:00:00.001Z')).toBe('2026-11-11');
    expect(firstDayFrom('2026-12-31T23:59:00.000Z')).toBe('2027-01-01');
  });
});
