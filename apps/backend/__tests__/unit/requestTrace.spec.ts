import { describe, it, expect } from '@jest/globals'
import { toProviderTag } from '../../src/app/middlewares/requestTrace.js'

describe('toProviderTag', () => {
  it.each([
    'apikey',
    'custom-jwt',
    'discord',
    'github',
    'google',
    'web3-wallet',
  ])('keeps the known provider %s', (provider) => {
    expect(toProviderTag(provider)).toBe(provider)
  })

  it('reports a missing header as unknown', () => {
    expect(toProviderTag(undefined)).toBe('unknown')
  })

  it('reports any other value as other', () => {
    expect(toProviderTag('Google')).toBe('other')
    expect(toProviderTag('not a provider')).toBe('other')
    expect(toProviderTag('')).toBe('other')
  })
})
