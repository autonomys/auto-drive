import { describe, it, expect } from '@jest/globals'
import {
  hasReachedConfirmationDepth,
  isStillCanonical,
  isAccountFault,
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

    it('treats chain/infrastructure failures as transient (no eviction)', () => {
      for (const status of [
        'Reorged',
        'Timeout',
        'Usurped',
        'ConfirmationError',
        'Failed',
        'InBlock',
        undefined,
      ]) {
        expect(isAccountFault(status)).toBe(false)
      }
    })
  })
})
