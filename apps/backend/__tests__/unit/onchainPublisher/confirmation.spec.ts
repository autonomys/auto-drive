import { describe, it, expect } from '@jest/globals'
import {
  hasReachedConfirmationDepth,
  isStillCanonical,
  isAccountFault,
  isInsufficientFundsError,
} from '../../../src/infrastructure/services/upload/onchainPublisher/confirmation.js'

describe('confirmation helpers', () => {
  describe('hasReachedConfirmationDepth', () => {
    it('is false until the head reaches inclusion + depth', () => {
      // inclusion at 100, depth 25 -> need head >= 125
      expect(hasReachedConfirmationDepth(124, 100, 25)).toBe(false)
      expect(hasReachedConfirmationDepth(110, 100, 25)).toBe(false)
    })

    it('is true exactly at inclusion + depth', () => {
      expect(hasReachedConfirmationDepth(125, 100, 25)).toBe(true)
    })

    it('is true beyond inclusion + depth', () => {
      expect(hasReachedConfirmationDepth(200, 100, 25)).toBe(true)
    })

    it('still requires one confirmation at minimum depth of 1', () => {
      expect(hasReachedConfirmationDepth(100, 100, 1)).toBe(false)
      expect(hasReachedConfirmationDepth(101, 100, 1)).toBe(true)
    })
  })

  describe('isStillCanonical', () => {
    it('is true when the canonical hash at the inclusion height is unchanged', () => {
      expect(isStillCanonical('0xabc', '0xabc')).toBe(true)
    })

    it('is false when a reorg replaced the inclusion block', () => {
      expect(isStillCanonical('0xdef', '0xabc')).toBe(false)
    })
  })

  describe('isAccountFault', () => {
    it('treats only Invalid as an account fault that evicts the signer', () => {
      expect(isAccountFault('Invalid')).toBe(true)
    })

    it('treats chain/infrastructure and balance failures as non-evicting', () => {
      for (const status of [
        'Reorged',
        'Timeout',
        'Usurped',
        'ConfirmationError',
        'Failed',
        'InsufficientFunds',
        'InBlock',
        undefined,
      ]) {
        expect(isAccountFault(status)).toBe(false)
      }
    })
  })

  describe('isInsufficientFundsError', () => {
    it('detects numeric and string error code 1010', () => {
      expect(isInsufficientFundsError({ code: 1010 })).toBe(true)
      expect(isInsufficientFundsError({ code: '1010' })).toBe(true)
    })

    it('detects error messages matching 1010 or fee payment inability', () => {
      expect(
        isInsufficientFundsError(
          new Error('1010: Invalid Transaction: Inability to pay some fees'),
        ),
      ).toBe(true)
      expect(
        isInsufficientFundsError({
          message: 'Inability to pay some fees',
        }),
      ).toBe(true)
      expect(
        isInsufficientFundsError(
          new Error('Account has insufficient balance for fees'),
        ),
      ).toBe(true)
    })

    it('returns false for non-balance errors and empty values', () => {
      expect(
        isInsufficientFundsError(new Error('WebSocket is not connected')),
      ).toBe(false)
      expect(isInsufficientFundsError(new Error('Transaction timeout'))).toBe(
        false,
      )
      expect(isInsufficientFundsError(null)).toBe(false)
      expect(isInsufficientFundsError(undefined)).toBe(false)
      expect(isInsufficientFundsError({})).toBe(false)
    })
  })
})
