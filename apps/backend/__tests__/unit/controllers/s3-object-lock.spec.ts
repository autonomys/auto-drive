import { describe, it, expect } from '@jest/globals'
import { Request } from 'express'
import js2xmlparser from 'js2xmlparser'
import { getS3Method } from '../../../src/app/controllers/s3/http.js'
import {
  objectLegalHoldBody,
  objectLockConfigurationBody,
  objectRetentionBody,
} from '../../../src/app/controllers/s3/s3.js'

const req = (
  method: string,
  query: Record<string, unknown>,
  headers: Record<string, unknown> = {},
): Request => ({ method, query, headers }) as unknown as Request

describe('getS3Method — Object Lock dispatch', () => {
  it('routes GET ?object-lock / ?retention / ?legal-hold to the read handlers', () => {
    expect(getS3Method(req('GET', { 'object-lock': '' }))).toBe(
      'GetObjectLockConfiguration',
    )
    expect(getS3Method(req('GET', { retention: '' }))).toBe(
      'GetObjectRetention',
    )
    expect(getS3Method(req('GET', { 'legal-hold': '' }))).toBe(
      'GetObjectLegalHold',
    )
  })

  it('routes PUT ?object-lock / ?retention / ?legal-hold to the 501 (Put*) operations', () => {
    expect(getS3Method(req('PUT', { 'object-lock': '' }))).toBe(
      'PutObjectLockConfiguration',
    )
    expect(getS3Method(req('PUT', { retention: '' }))).toBe(
      'PutObjectRetention',
    )
    expect(getS3Method(req('PUT', { 'legal-hold': '' }))).toBe(
      'PutObjectLegalHold',
    )
  })

  it('does not disturb existing GET/PUT routing', () => {
    expect(getS3Method(req('GET', { 'list-type': '2' }))).toBe('ListObjectsV2')
    expect(getS3Method(req('GET', {}))).toBe('GetObject')
    expect(getS3Method(req('GET', { uploadId: '1' }))).toBe('ListParts')
    expect(getS3Method(req('PUT', {}))).toBe('PutObject')
    expect(
      getS3Method(req('PUT', {}, { 'x-amz-copy-source': '/b/k' })),
    ).toBe('CopyObject')
  })
})

describe('Object Lock response bodies', () => {
  it('GetObjectLockConfiguration advertises Enabled + COMPLIANCE default retention', () => {
    expect(objectLockConfigurationBody()).toEqual({
      ObjectLockEnabled: 'Enabled',
      Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: 100 } },
    })
    const xml = js2xmlparser.parse(
      'ObjectLockConfiguration',
      objectLockConfigurationBody(),
    )
    expect(xml).toContain('<ObjectLockEnabled>Enabled</ObjectLockEnabled>')
    expect(xml).toContain('<Mode>COMPLIANCE</Mode>')
    expect(xml).toContain('<Years>100</Years>')
  })

  it('GetObjectRetention is COMPLIANCE with the max-date "forever" RetainUntilDate', () => {
    const body = objectRetentionBody()
    expect(body.Mode).toBe('COMPLIANCE')
    // Year 9999 is the max date common clients (e.g. Python datetime.max) parse.
    expect(body.RetainUntilDate).toBe('9999-12-31T23:59:59Z')
    const xml = js2xmlparser.parse('Retention', body)
    expect(xml).toContain('<Mode>COMPLIANCE</Mode>')
    expect(xml).toContain(`<RetainUntilDate>${body.RetainUntilDate}`)
  })

  it('GetObjectLegalHold is ON', () => {
    expect(objectLegalHoldBody()).toEqual({ Status: 'ON' })
    expect(js2xmlparser.parse('LegalHold', objectLegalHoldBody())).toContain(
      '<Status>ON</Status>',
    )
  })
})
