import { describe, it, expect } from '@jest/globals'
import { toLineProtocol } from '../../src/infrastructure/drivers/vmetrics.js'

describe('toLineProtocol', () => {
  it('formats measurement, tags and numeric fields', () => {
    expect(
      toLineProtocol({
        measurement: 'auto_drive_interactions',
        tags: { chain: 'mainnet', type: 'upload' },
        fields: { size: 10n, ratio: 0.5 },
      }),
    ).toBe('auto_drive_interactions,chain=mainnet,type=upload size=10,ratio=0.5')
  })

  it('keeps tag values ending in i or u as plain strings', () => {
    expect(
      toLineProtocol({
        measurement: 'auto_drive_api_request',
        tags: { path: '/bafkr6ibi', provider: 'menu' },
        fields: { status: 200 },
      }),
    ).toBe('auto_drive_api_request,path=/bafkr6ibi,provider=menu status=200')
  })

  it('escapes spaces, commas, equals signs and backslashes', () => {
    expect(
      toLineProtocol({
        measurement: 'a b,c',
        tags: { 'k=1': 'x y,z=w\\' },
        fields: { 'f g': 1 },
      }),
    ).toBe('a\\ b\\,c,k\\=1=x\\ y\\,z\\=w\\\\ f\\ g=1')
  })

  it('leaves double quotes in tag values untouched', () => {
    expect(
      toLineProtocol({
        measurement: 'm',
        tags: { provider: '"google"' },
        fields: { count: 1 },
      }),
    ).toBe('m,provider="google" count=1')
  })

  it('replaces line breaks so a metric stays on one line', () => {
    expect(
      toLineProtocol({
        measurement: 'm',
        tags: { provider: 'a\r\nb' },
        fields: { count: 1 },
      }),
    ).toBe('m,provider=a\\ b count=1')
  })

  it('omits empty tag values', () => {
    expect(
      toLineProtocol({
        measurement: 'm',
        tags: { chain: 'mainnet', provider: '' },
        fields: { count: 1 },
      }),
    ).toBe('m,chain=mainnet count=1')
  })

  it('writes no tag separator when there are no tags', () => {
    expect(
      toLineProtocol({ measurement: 'm', tags: {}, fields: { count: 1 } }),
    ).toBe('m count=1')
  })

  it('writes bigints beyond the safe integer range exactly', () => {
    expect(
      toLineProtocol({
        measurement: 'usdc_treasury',
        tags: {},
        fields: { balance_base_units: 9007199254740993n },
      }),
    ).toBe('usdc_treasury balance_base_units=9007199254740993')
  })
})
