/** @jest-environment jsdom */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useQuoteClock } from '../../../src/hooks/useQuoteClock';

describe('checkout quote clock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('ticks while a quote exists and removes its timer when unmounted', () => {
    const start = Date.now();
    const { result, unmount } = renderHook(() =>
      useQuoteClock(new Date(start + 60_000)),
    );
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(start + 1000);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['focus', 'visibilitychange'])(
    'catches up immediately on %s without waiting for a timer tick',
    (event) => {
      const start = Date.now();
      const { result } = renderHook(() =>
        useQuoteClock(new Date(start + 60_000)),
      );
      act(() => {
        jest.setSystemTime(start + 120_000);
        (event === 'focus' ? window : document).dispatchEvent(new Event(event));
      });
      expect(result.current).toBe(start + 120_000);
    },
  );

  it('does not start a timer without a quote', () => {
    renderHook(() => useQuoteClock(null));
    expect(jest.getTimerCount()).toBe(0);
  });
});
