import { describe, it, expect } from '@jest/globals'
import { Request } from 'express'
import js2xmlparser from 'js2xmlparser'
import { getS3Method } from '../../../src/app/controllers/s3/http.js'
import {
  bucketVersioningBody,
  objectLegalHoldBody,
  objectLockConfigurationBody,
  objectRetentionBody,
} from '../../../src/app/controllers/s3/s3.js'

const req = (
  method: string,
  query: Record<string, unknown>,
  headers: Record<string, unknown> = {},
): Request => ({ method, query, headers }) as unknown as Request

describe('getS3Method — Object Lock / versioning dispatch', () => {
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

  it('routes GET ?versioning / ?versions to the versioning read handlers', () => {
    expect(getS3Method(req('GET', { versioning: '' }))).toBe(
      'GetBucketVersioning',
    )
    expect(getS3Method(req('GET', { versions: '' }))).toBe('ListObjectVersions')
  })

  it('routes a versioned DELETE to the (refused) DeleteObjectVersion op', () => {
    expect(getS3Method(req('DELETE', { versionId: 'bafy...' }))).toBe(
      'DeleteObjectVersion',
    )
    // A bare DELETE is still an ordinary soft-delete.
    expect(getS3Method(req('DELETE', {}))).toBe('DeleteObject')
  })

  it('routes PUT ?object-lock / ?retention / ?legal-hold / ?versioning to the 501 (Put*) operations', () => {
    expect(getS3Method(req('PUT', { 'object-lock': '' }))).toBe(
      'PutObjectLockConfiguration',
    )
    expect(getS3Method(req('PUT', { retention: '' }))).toBe(
      'PutObjectRetention',
    )
    expect(getS3Method(req('PUT', { 'legal-hold': '' }))).toBe(
      'PutObjectLegalHold',
    )
    expect(getS3Method(req('PUT', { versioning: '' }))).toBe(
      'PutBucketVersioning',
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

// Auto Drive advertises an honest COMPLIANCE/WORM Object Lock: DSN content is
// permanent and versions are indestructible, so versioning is Enabled, the lock
// is COMPLIANCE with retain-forever retention, and legal hold — a separate,
// client-set per-object concept Auto Drive has no equivalent for — stays OFF.
describe('Versioning + Object Lock response bodies', () => {
  it('GetBucketVersioning is Enabled', () => {
    expect(bucketVersioningBody()).toEqual({ Status: 'Enabled' })
    expect(
      js2xmlparser.parse('VersioningConfiguration', bucketVersioningBody()),
    ).toContain('<Status>Enabled</Status>')
  })

  it('GetObjectLockConfiguration is an Enabled COMPLIANCE lock', () => {
    const body = objectLockConfigurationBody()
    expect(body.ObjectLockEnabled).toBe('Enabled')
    expect(body.Rule.DefaultRetention.Mode).toBe('COMPLIANCE')
    const xml = js2xmlparser.parse('ObjectLockConfiguration', body)
    expect(xml).toContain('<ObjectLockEnabled>Enabled</ObjectLockEnabled>')
    expect(xml).toContain('<Mode>COMPLIANCE</Mode>')
  })

  it('GetObjectRetention is COMPLIANCE, retained to the year-9999 forever sentinel', () => {
    const body = objectRetentionBody()
    expect(body.Mode).toBe('COMPLIANCE')
    expect(body.RetainUntilDate).toBe('9999-12-31T23:59:59Z')
  })

  it('GetObjectLegalHold is OFF (no per-object hold concept)', () => {
    expect(objectLegalHoldBody()).toEqual({ Status: 'OFF' })
    expect(js2xmlparser.parse('LegalHold', objectLegalHoldBody())).toContain(
      '<Status>OFF</Status>',
    )
  })
})
