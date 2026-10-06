import { describe, expect, it } from '@jest/globals';
import {
  BaseError,
  InsufficientFundsError,
  UserRejectedRequestError,
} from 'viem';
import {
  isBatchUnsupported,
  wasNotSubmitted,
} from '../../../src/utils/usdcWalletErrors';

describe('wallet submission errors', () => {
  it.each([4001, 4100, 4200, -32601, -32602, 5700, 5710, 5740, 5750, 5760])(
    'recognizes explicit refusal %s through nested causes',
    (code) => {
      expect(wasNotSubmitted({ cause: { cause: { code } } })).toBe(true);
    },
  );

  it('recognizes viem errors as well as raw provider errors', () => {
    expect(
      wasNotSubmitted(
        new BaseError('wrapper', {
          cause: new UserRejectedRequestError(new Error('declined')),
        }),
      ),
    ).toBe(true);
    expect(wasNotSubmitted(new InsufficientFundsError({}))).toBe(true);
  });

  it.each([4900, 4901, -32603, -32000, 5720, 5730])(
    'keeps unknown outcomes locked for code %s',
    (code) => {
      expect(wasNotSubmitted({ cause: { code } })).toBe(false);
    },
  );

  it('does not infer non-submission from error text', () => {
    expect(wasNotSubmitted(new Error('request timed out'))).toBe(false);
    expect(wasNotSubmitted(new Error('nonce too low'))).toBe(false);
    expect(wasNotSubmitted(new Error('user rejected'))).toBe(false);
  });

  it('does not treat rejection or a duplicate batch ID as permission to fall back', () => {
    expect(isBatchUnsupported({ code: 4001 })).toBe(false);
    expect(isBatchUnsupported({ code: 5750 })).toBe(false);
    expect(isBatchUnsupported({ code: 5720 })).toBe(false);
  });
});
