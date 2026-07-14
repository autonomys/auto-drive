import { describe, it, expect } from '@jest/globals'
import { Request } from 'express'
import js2xmlparser from 'js2xmlparser'
import { getS3Method } from '../../../src/app/controllers/s3/http.js'
import { objectLegalHoldBody } from '../../../src/app/controllers/s3/s3.js'

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

// Object Lock is not enforced now that the S3 namespace is mutable (delete /
// overwrite / rename succeed), so the read endpoints report "no lock": the
// configuration/retention handlers return 404 ObjectLockConfigurationNotFound /
// NoSuchObjectLockConfiguration (exercised via the endpoints), and legal hold is
// always OFF.
describe('Object Lock response bodies', () => {
  it('GetObjectLegalHold is OFF (no enforceable hold)', () => {
    expect(objectLegalHoldBody()).toEqual({ Status: 'OFF' })
    expect(js2xmlparser.parse('LegalHold', objectLegalHoldBody())).toContain(
      '<Status>OFF</Status>',
    )
  })
})
