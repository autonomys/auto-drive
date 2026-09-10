/**
 * @jest-environment jsdom
 */

/**
 * The record that lets a confirming USDC payment survive a reload.
 *
 * Both ids live in component state and a refresh destroys them, while the
 * payment is already on chain and the backend credits it regardless. What is
 * lost is the screen that would have said so — for ~72s on Ethereum, which is
 * long enough to be reached by accident.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  clearUsdcResume,
  readUsdcResume,
  saveUsdcResume,
} from '../../../src/utils/usdcResume';

const RECORD = {
  intentId: '0xabc',
  txHash: '0xdead',
  sizeMib: 1024,
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('usdcResume', () => {
  it('round-trips a payment in flight', () => {
    saveUsdcResume(RECORD);
    expect(readUsdcResume(1024)).toEqual(RECORD);
  });

  it('is nothing when no payment was in flight', () => {
    expect(readUsdcResume(1024)).toBeNull();
  });

  it('refuses a record from a different purchase', () => {
    // A buyer who reloads and then picks a different amount must not have the
    // previous purchase's hash attached to it — that is a confirmation screen
    // for a payment with nothing to do with what they are now buying.
    saveUsdcResume(RECORD);
    expect(readUsdcResume(2048)).toBeNull();
  });

  it('is cleared once the purchase has an answer', () => {
    saveUsdcResume(RECORD);
    clearUsdcResume();
    expect(readUsdcResume(1024)).toBeNull();
  });

  it('survives a corrupted entry rather than throwing under the buyer', () => {
    sessionStorage.setItem('auto-drive:usdc-purchase-in-flight', 'not json');
    expect(readUsdcResume(1024)).toBeNull();

    sessionStorage.setItem(
      'auto-drive:usdc-purchase-in-flight',
      JSON.stringify({ nothing: 'useful' }),
    );
    expect(readUsdcResume(1024)).toBeNull();
  });

  it('does not throw when storage itself is unavailable', () => {
    // A private window, or a browser set to block site data. The payment is
    // unaffected and the only cost is that a reload will not pick it back up,
    // so this must never be the thing that breaks a purchase.
    const broken = () => {
      throw new Error('SecurityError');
    };
    const original = Object.getOwnPropertyDescriptor(
      window,
      'sessionStorage',
    ) as PropertyDescriptor;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: broken,
    });

    expect(() => saveUsdcResume(RECORD)).not.toThrow();
    expect(readUsdcResume(1024)).toBeNull();
    expect(() => clearUsdcResume()).not.toThrow();

    Object.defineProperty(window, 'sessionStorage', original);
  });
});
