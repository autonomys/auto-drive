import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { S3UseCases } from '../../../src/core/s3/index.js'
import { s3ObjectMappingsRepository } from '../../../src/infrastructure/repositories/index.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { DownloadUseCase } from '../../../src/core/downloads/index.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { UserWithOrganization } from '@auto-drive/models'
import { ok, err } from 'neverthrow'
import { ObjectNotFoundError, ForbiddenError } from '../../../src/errors/index.js'

/** Quoted single-object MD5 ETag: `"<32 hex chars>"` */
const MD5_ETAG_RE = /^"[a-f0-9]{32}"$/
/** Composite multipart ETag: `"<32 hex chars>-<N>"` */
const MULTIPART_ETAG_RE = /^"[a-f0-9]{32}-\d+"$/
/** Multipart MD5 as stored in the DB (no outer quotes): `<32 hex chars>-<N>` */
const MULTIPART_MD5_RE = /^[a-f0-9]{32}-\d+$/

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('S3UseCases', () => {
  // The S3 namespace is per user; the use cases pass this user's identity into
  // every scoped repository call. 'google'/'user1' is the caller throughout.
  const mockUser: UserWithOrganization = {
    id: 'user1',
    publicId: 'pub1',
    organizationId: 'org1',
    walletAddress: '0xuser',
    oauthProvider: 'google',
    oauthUserId: 'user1',
  } as any

  const mapping = (over: Record<string, unknown> = {}) =>
    ({
      bucket: 'my-bucket',
      key: 'file.txt',
      cid: 'cid123',
      md5: null,
      mtime: null,
      metadata: null,
      ownerOauthProvider: 'google',
      ownerOauthUserId: 'user1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...over,
    }) as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getObject', () => {
    // getObject (non-versioned) looks up the current version to anchor
    // Last-Modified to its write time; default to "no version row" so the tests
    // that don't exercise it fall back to the mapping without hitting the DB.
    beforeEach(() => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findVersionByCid')
        .mockResolvedValue(null)
    })

    it('returns an error when the caller has no such key', async () => {
      const findSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(null)

      const result = await S3UseCases.getObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'nope.txt',
      } as any)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
      // Lookup is scoped to the caller.
      expect(findSpy).toHaveBeenCalledWith('google', 'user1', 'my-bucket', 'nope.txt')
    })

    it('propagates a download error', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ md5: 'abc123' }))
      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(err(new ObjectNotFoundError('Download failed')) as any)

      const result = await S3UseCases.getObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
      } as any)

      expect(result.isErr()).toBe(true)
    })

    it('returns the download result with cid and MD5 etag', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ md5: 'abc123def456abc123def456abc123de' }))
      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok({ read: jest.fn() }) as any)

      const result = await S3UseCases.getObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().cid).toBe('cid123')
      expect(result._unsafeUnwrap().etag).toBe(
        '"abc123def456abc123def456abc123de"',
      )
    })

    it('surfaces the stored object metadata for the response layer', async () => {
      const objectMetadata = {
        contentType: 'text/csv',
        cacheControl: 'max-age=99',
        userMetadata: { foo: 'bar' },
      }
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ metadata: objectMetadata }))
      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok({ read: jest.fn() }) as any)

      const result = await S3UseCases.getObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().objectMetadata).toEqual(objectMetadata)
    })

    it('anchors Last-Modified to the current version’s createdAt, not mapping.updatedAt', async () => {
      const writtenAt = new Date(1720000000000)
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ updatedAt: new Date(1730000000000) }))
      jest
        .spyOn(s3ObjectMappingsRepository, 'findVersionByCid')
        .mockResolvedValue({
          bucket: 'my-bucket',
          key: 'file.txt',
          cid: 'cid123',
          md5: null,
          mtime: null,
          metadata: null,
          createdAt: writtenAt,
        })
      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok({ read: jest.fn() }) as any)

      const result = await S3UseCases.getObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
      } as any)

      expect(result.isOk()).toBe(true)
      // The version's immutable write time, not the drift-prone mapping.updatedAt.
      expect(result._unsafeUnwrap().lastModified).toEqual(writtenAt)
    })

    it('returns a null etag for legacy objects without md5', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ md5: null }))
      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok({} as any) as any)

      const result = await S3UseCases.getObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().etag).toBeNull()
    })

    it('passes the byte range to the download use case', async () => {
      const downloadSpy = jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok({} as any) as any)
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping())

      await S3UseCases.getObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
        Range: [100, 200],
      } as any)

      expect(downloadSpy).toHaveBeenCalledWith(
        'cid123',
        expect.objectContaining({ byteRange: [100, 200] }),
      )
    })

    it('serves a specific version by CID and returns that version’s content', async () => {
      const version = {
        bucket: 'my-bucket',
        key: 'file.txt',
        cid: 'oldcid',
        md5: 'abc123def456abc123def456abc123de',
        mtime: '111.5',
        metadata: { contentType: 'text/csv' },
        createdAt: new Date(5000),
      }
      const findVersionSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'findVersionByCid')
        .mockResolvedValue(version as any)
      const findByKeySpy = jest.spyOn(s3ObjectMappingsRepository, 'findByKey')
      const downloadSpy = jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok({ read: jest.fn() }) as any)

      const result = await S3UseCases.getObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
        VersionId: 'oldcid',
      } as any)

      expect(result.isOk()).toBe(true)
      const value = result._unsafeUnwrap()
      expect(value.cid).toBe('oldcid')
      expect(value.mtime).toBe('111.5')
      expect(value.objectMetadata).toEqual({ contentType: 'text/csv' })
      expect(value.lastModified).toEqual(new Date(5000))
      // The version is fetched by its own CID, and the current-pointer lookup is
      // bypassed entirely.
      expect(findVersionSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'my-bucket',
        'file.txt',
        'oldcid',
      )
      expect(downloadSpy).toHaveBeenCalledWith('oldcid', expect.any(Object))
      expect(findByKeySpy).not.toHaveBeenCalled()
    })

    it('returns not-found for an unknown versionId', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findVersionByCid')
        .mockResolvedValue(null)

      const result = await S3UseCases.getObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
        VersionId: 'nope',
      } as any)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })
  })

  describe('getObjectVersions', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      key: 'file.txt',
      cid: 'cid1',
      md5: null,
      size: 10n,
      lastModified: new Date(1000),
      pointerDeletedAt: null,
      ownerRemoved: false,
      ...over,
    })

    it('marks the newest version of a live key IsLatest and orders by the rows given', async () => {
      // Repo returns newest-first per key.
      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjectVersions')
        .mockResolvedValue([
          row({ cid: 'cid2', lastModified: new Date(2000) }),
          row({ cid: 'cid1', lastModified: new Date(1000) }),
        ] as any)

      const result = await S3UseCases.getObjectVersions(mockUser, {
        bucket: 'b',
        prefix: '',
        keyMarker: null,
        maxKeys: 1000,
      })

      expect(result.versions.map((v) => v.versionId)).toEqual(['cid2', 'cid1'])
      expect(result.versions[0].isLatest).toBe(true)
      expect(result.versions[1].isLatest).toBe(false)
      expect(result.deleteMarkers).toHaveLength(0)
      expect(result.isTruncated).toBe(false)
    })

    it('synthesises a delete marker as latest when the current pointer is deleted', async () => {
      const deletedAt = new Date(3000)
      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjectVersions')
        .mockResolvedValue([
          row({ cid: 'cid2', pointerDeletedAt: deletedAt }),
          row({ cid: 'cid1', pointerDeletedAt: deletedAt }),
        ] as any)

      const result = await S3UseCases.getObjectVersions(mockUser, {
        bucket: 'b',
        prefix: '',
        keyMarker: null,
        maxKeys: 1000,
      })

      // No content version is latest; the synthesised marker is.
      expect(result.versions.every((v) => !v.isLatest)).toBe(true)
      expect(result.deleteMarkers).toHaveLength(1)
      expect(result.deleteMarkers[0].isLatest).toBe(true)
      expect(result.deleteMarkers[0].lastModified).toEqual(deletedAt)
    })

    it('synthesises a delete marker for an owner-removed key with no deleted_at', async () => {
      // Web-app Trash / moderation: mapping still live (pointerDeletedAt null) but
      // the content is owner-removed. GET/ListObjectsV2/GetObjectRetention treat
      // it as absent, so ListObjectVersions must show a delete marker, not a live
      // content version.
      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjectVersions')
        .mockResolvedValue([
          row({ cid: 'cid2', lastModified: new Date(2000), ownerRemoved: true }),
          row({ cid: 'cid1', lastModified: new Date(1000), ownerRemoved: true }),
        ] as any)

      const result = await S3UseCases.getObjectVersions(mockUser, {
        bucket: 'b',
        prefix: '',
        keyMarker: null,
        maxKeys: 1000,
      })

      // Both content versions remain listed (history survives), none IsLatest.
      expect(result.versions.map((v) => v.versionId)).toEqual(['cid2', 'cid1'])
      expect(result.versions.every((v) => !v.isLatest)).toBe(true)
      // Marker is latest; with no deleted_at it takes the newest version's time.
      expect(result.deleteMarkers).toHaveLength(1)
      expect(result.deleteMarkers[0].isLatest).toBe(true)
      expect(result.deleteMarkers[0].lastModified).toEqual(new Date(2000))
    })

    it('truncates at maxKeys and reports the next key marker', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjectVersions')
        .mockResolvedValue([
          row({ key: 'a.txt', cid: 'a1' }),
          row({ key: 'b.txt', cid: 'b1' }),
          row({ key: 'c.txt', cid: 'c1' }),
        ] as any)

      const result = await S3UseCases.getObjectVersions(mockUser, {
        bucket: 'b',
        prefix: '',
        keyMarker: null,
        maxKeys: 2,
      })

      expect(result.versions.map((v) => v.key)).toEqual(['a.txt', 'b.txt'])
      expect(result.isTruncated).toBe(true)
      expect(result.nextKeyMarker).toBe('b.txt')
    })

    it('collapses repeated same-CID writes into one version (versionId = CID is unique per key)', async () => {
      // The repo returns newest-first; the same CID recurs when identical content
      // is written more than once (e.g. an mtime-only copy-to-self / SetModTime).
      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjectVersions')
        .mockResolvedValue([
          row({ cid: 'cidX', md5: 'newmd5', lastModified: new Date(3000) }),
          row({ cid: 'cidY', md5: 'ymd5', lastModified: new Date(2000) }),
          row({ cid: 'cidX', md5: 'oldmd5', lastModified: new Date(1000) }),
        ] as any)

      const result = await S3UseCases.getObjectVersions(mockUser, {
        bucket: 'b',
        prefix: '',
        keyMarker: null,
        maxKeys: 1000,
      })

      // cidX collapses to a single entry — no duplicate versionId in the listing.
      expect(result.versions.map((v) => v.versionId)).toEqual(['cidX', 'cidY'])
      expect(result.versions[0].isLatest).toBe(true)
      // The newest cidX row's metadata is the one kept.
      expect(result.versions[0].etag).toBe('"newmd5"')
    })
  })

  describe('createMultipartUpload', () => {
    it('creates the upload; stashes nothing when neither mtime nor metadata is supplied', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)
      const metaSpy = jest.spyOn(s3ObjectMappingsRepository, 'setMultipartMeta')

      const result = await S3UseCases.createMultipartUpload(mockUser, {
        Bucket: 'bucket',
        Key: 'file.txt',
        ContentType: 'text/plain',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(metaSpy).not.toHaveBeenCalled()
    })

    it('stashes the client mtime by upload id when provided', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)
      const metaSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'setMultipartMeta')
        .mockResolvedValue(undefined)

      await S3UseCases.createMultipartUpload(mockUser, {
        Bucket: 'bucket',
        Key: 'file.txt',
        Mtime: '1620000000.5',
      } as any)

      expect(metaSpy).toHaveBeenCalledWith('upload123', '1620000000.5', null)
    })

    it('stashes the object metadata by upload id when provided', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)
      const metaSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'setMultipartMeta')
        .mockResolvedValue(undefined)

      const metadata = { contentType: 'text/csv', userMetadata: { a: '1' } }
      await S3UseCases.createMultipartUpload(mockUser, {
        Bucket: 'bucket',
        Key: 'file.txt',
        Metadata: metadata,
      } as any)

      expect(metaSpy).toHaveBeenCalledWith('upload123', null, metadata)
    })
  })

  describe('uploadPart', () => {
    it('uploads the part and returns its MD5 ETag', async () => {
      jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockResolvedValue(ok({} as any) as any)

      const result = await S3UseCases.uploadPart(mockUser, {
        Bucket: 'bucket',
        Key: 'file.txt',
        PartNumber: 1,
        UploadId: 'upload123',
        Body: Buffer.from('data'),
      } as any)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().ETag).toMatch(MD5_ETAG_RE)
    })
  })

  describe('completeMultipartUpload', () => {
    it('completes the upload, persists the composite ETag + stashed mtime/metadata under the caller', async () => {
      const completeSpy = jest
        .spyOn(UploadsUseCases, 'completeUpload')
        .mockResolvedValue('cid123')
      const mappingSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(mapping())
      const stashedMetadata = { contentType: 'text/csv' }
      jest
        .spyOn(s3ObjectMappingsRepository, 'getMultipartMeta')
        .mockResolvedValue({ mtime: '1620000000.5', metadata: stashedMetadata })
      const clearMetaSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'deleteMultipartMeta')
        .mockResolvedValue(undefined)

      const result = await S3UseCases.completeMultipartUpload(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
        UploadId: 'upload123',
        Parts: [
          { PartNumber: 1, ETag: '"aabbccdd11223344aabbccdd11223344"' },
          { PartNumber: 2, ETag: '"eeff00112233445566778899aabbccdd"' },
        ],
      } as any)

      expect(result.isOk()).toBe(true)
      expect(completeSpy).toHaveBeenCalledWith(mockUser, 'upload123')
      expect(result._unsafeUnwrap().ETag).toMatch(MULTIPART_ETAG_RE)
      expect(result._unsafeUnwrap().Cid).toBe('cid123')
      // createMapping is owner-scoped: (owner, owner, bucket, key, cid, md5, mtime, metadata).
      expect(mappingSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'my-bucket',
        'file.txt',
        'cid123',
        expect.stringMatching(MULTIPART_MD5_RE),
        '1620000000.5',
        stashedMetadata,
      )
      expect(clearMetaSpy).toHaveBeenCalledWith('upload123')
    })
  })

  describe('putObject', () => {
    const setupPut = () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)
      jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockResolvedValue(ok({} as any) as any)
      jest.spyOn(UploadsUseCases, 'completeUpload').mockResolvedValue('cid123')
    }

    it('puts the object and returns the MD5 ETag + CID', async () => {
      setupPut()
      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(mapping({ md5: 'd41d8cd98f00b204e9800998ecf8427e' }))

      const result = await S3UseCases.putObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'path/file.txt',
        Body: Buffer.from('data'),
        ContentType: 'text/plain',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().ETag).toMatch(MD5_ETAG_RE)
      expect(result._unsafeUnwrap().Cid).toBe('cid123')
    })

    it('extracts the filename from the key path', async () => {
      const createSpy = jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)
      jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockResolvedValue(ok({} as any) as any)
      jest.spyOn(UploadsUseCases, 'completeUpload').mockResolvedValue('cid123')
      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(mapping())

      await S3UseCases.putObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'deep/path/file.txt',
        Body: Buffer.from('data'),
      } as any)

      expect(createSpy).toHaveBeenCalledWith(
        mockUser,
        'file.txt',
        null,
        null,
        null,
        null,
      )
    })

    it('surfaces an upload-chunk error', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)
      jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockRejectedValue(new Error('Upload failed'))
      jest.spyOn(UploadsUseCases, 'completeUpload').mockResolvedValue('cid123')
      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(mapping())

      const result = await S3UseCases.putObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
        Body: Buffer.from('data'),
      } as any)

      expect(result.isErr()).toBe(true)
    })

    it('creates the mapping under the caller with the body MD5 and mtime', async () => {
      setupPut()
      const mappingSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(mapping())

      await S3UseCases.putObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
        Body: Buffer.from('Hello, world!'),
      } as any)

      // MD5 of "Hello, world!"; owner-scoped (owner, owner, bucket, key, cid, md5, mtime, metadata).
      expect(mappingSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'my-bucket',
        'file.txt',
        'cid123',
        '6cd3556deb0da54bca060b4c39479839',
        null,
        null,
      )
    })

    it('persists the captured object metadata onto the mapping', async () => {
      setupPut()
      const mappingSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(mapping())
      const metadata = {
        contentType: 'text/csv',
        cacheControl: 'no-cache',
        userMetadata: { author: 'alice' },
      }

      await S3UseCases.putObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
        Body: Buffer.from('data'),
        Metadata: metadata,
      } as any)

      // metadata is the 8th positional argument.
      expect(mappingSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'my-bucket',
        'file.txt',
        'cid123',
        expect.any(String),
        null,
        metadata,
      )
    })
  })

  describe('listObjects', () => {
    // dbLimit for delimiter listings is min(maxKeys * 10 + 100, 10_000), so
    // maxKeys=2 yields dbLimit=120 — small enough to construct test data for.
    const DELIMITER_DB_LIMIT = (maxKeys: number) =>
      Math.min(maxKeys * 10 + 100, 10_000)

    const makeListing = (key: string) => ({
      key,
      cid: 'cid',
      size: 0n,
      lastModified: new Date(0),
      md5: null,
    })

    it('scopes the listing to the caller and advances the token past a folded CommonPrefix', async () => {
      const maxKeys = 2
      const dbLimit = DELIMITER_DB_LIMIT(maxKeys)
      const fullBatch = Array.from({ length: dbLimit }, (_, i) =>
        makeListing(`big/${String(i).padStart(6, '0')}`),
      )
      const listSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'listObjects')
        .mockResolvedValue(fullBatch as any)

      const result = await S3UseCases.listObjects(mockUser, {
        bucket: 'my-bucket',
        prefix: '',
        delimiter: '/',
        maxKeys,
        continuationToken: null,
      })

      // Scoped to the caller: (owner, owner, bucket, prefix, token, dbLimit).
      expect(listSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'my-bucket',
        '',
        null,
        dbLimit,
      )
      expect(result.commonPrefixes).toEqual(['big/'])
      expect(result.objects).toEqual([])
      expect(result.isTruncated).toBe(true)
      expect(result.nextContinuationToken).toBe('big/￿')
      expect(
        result.nextContinuationToken! > fullBatch[fullBatch.length - 1].key,
      ).toBe(true)
    })

    it('uses the raw last key as the token when the last scanned key did not fold into a prefix', async () => {
      const maxKeys = 2
      const dbLimit = DELIMITER_DB_LIMIT(maxKeys)
      const batch = [
        ...Array.from({ length: dbLimit - 1 }, (_, i) =>
          makeListing(`folder/${String(i).padStart(6, '0')}`),
        ),
        makeListing('zzz-top-level'),
      ]
      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjects')
        .mockResolvedValue(batch as any)

      const result = await S3UseCases.listObjects(mockUser, {
        bucket: 'my-bucket',
        prefix: '',
        delimiter: '/',
        maxKeys,
        continuationToken: null,
      })

      expect(result.isTruncated).toBe(true)
      expect(result.nextContinuationToken).toBe('zzz-top-level')
    })

    it('uses the raw last key as the token when no delimiter is set', async () => {
      const maxKeys = 2
      const batch = [
        makeListing('a.txt'),
        makeListing('b.txt'),
        makeListing('c.txt'),
      ]
      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjects')
        .mockResolvedValue(batch as any)

      const result = await S3UseCases.listObjects(mockUser, {
        bucket: 'my-bucket',
        prefix: '',
        delimiter: null,
        maxKeys,
        continuationToken: null,
      })

      expect(result.objects.map((o) => o.key)).toEqual(['a.txt', 'b.txt'])
      expect(result.isTruncated).toBe(true)
      expect(result.nextContinuationToken).toBe('b.txt')
    })
  })

  describe('deleteObject', () => {
    it('trashes the object then hides the key when it was the caller’s last reference', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping())
      jest
        .spyOn(s3ObjectMappingsRepository, 'countActiveMappingsByCid')
        .mockResolvedValue(1)
      const markSpy = jest
        .spyOn(ObjectUseCases, 'markAsDeleted')
        .mockResolvedValue(ok(undefined))
      const softDeleteSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'softDeleteMapping')
        .mockResolvedValue({ cid: 'cid123', deletedAt: new Date(5000) })

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'file.txt',
      )

      expect(result.isOk()).toBe(true)
      // A delete marker was created; its versionId derives from the delete time
      // (new Date(5000) → dm-5000), matching what ListObjectVersions reports.
      expect(result._unsafeUnwrap()).toEqual({
        deleteMarker: true,
        versionId: 'dm-5000',
      })
      expect(markSpy).toHaveBeenCalledWith(mockUser, 'cid123')
      expect(softDeleteSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'my-bucket',
        'file.txt',
      )
    })

    it('does not trash the object when the caller still has another key for it', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ key: 'copy.txt' }))
      // before-hide = 2, after-hide re-check = 1 (sibling still active).
      jest
        .spyOn(s3ObjectMappingsRepository, 'countActiveMappingsByCid')
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
      const markSpy = jest
        .spyOn(ObjectUseCases, 'markAsDeleted')
        .mockResolvedValue(ok(undefined))
      jest
        .spyOn(s3ObjectMappingsRepository, 'softDeleteMapping')
        .mockResolvedValue({ cid: 'cid123', deletedAt: new Date(5000) })

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'copy.txt',
      )

      expect(result.isOk()).toBe(true)
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('trashes via the race guard when a concurrent delete removed the sibling', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ key: 'k2.txt' }))
      jest
        .spyOn(s3ObjectMappingsRepository, 'countActiveMappingsByCid')
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
      const markSpy = jest
        .spyOn(ObjectUseCases, 'markAsDeleted')
        .mockResolvedValue(ok(undefined))
      jest
        .spyOn(s3ObjectMappingsRepository, 'softDeleteMapping')
        .mockResolvedValue({ cid: 'cid123', deletedAt: new Date(5000) })

      const result = await S3UseCases.deleteObject(mockUser, 'my-bucket', 'k2.txt')

      expect(result.isOk()).toBe(true)
      expect(markSpy).toHaveBeenCalledWith(mockUser, 'cid123')
    })

    it('is a no-op with no marker when the key never existed', async () => {
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue(null)
      // No soft-deleted row either: the key never existed → no delete marker.
      jest
        .spyOn(s3ObjectMappingsRepository, 'findSoftDeletedByKey')
        .mockResolvedValue(null)
      const softDeleteSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'softDeleteMapping',
      )
      const markSpy = jest.spyOn(ObjectUseCases, 'markAsDeleted')

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'missing.txt',
      )

      expect(result.isOk()).toBe(true)
      // No active key was hidden and none was already deleted, so no marker.
      expect(result._unsafeUnwrap()).toEqual({
        deleteMarker: false,
        versionId: null,
      })
      expect(softDeleteSpy).not.toHaveBeenCalled()
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('reports the existing delete marker on a repeat delete of an already-deleted key', async () => {
      // findByKey hides soft-deleted rows, so a repeat DeleteObject sees no live
      // key — but the current state IS a delete marker, so report it (no new
      // marker is created).
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue(null)
      jest
        .spyOn(s3ObjectMappingsRepository, 'findSoftDeletedByKey')
        .mockResolvedValue({ deletedAt: new Date(5000) })
      const softDeleteSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'softDeleteMapping',
      )

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'already-deleted.txt',
      )

      expect(result.isOk()).toBe(true)
      // Current state is the existing marker (dm-<its deleted_at>); nothing new.
      expect(result._unsafeUnwrap()).toEqual({
        deleteMarker: true,
        versionId: 'dm-5000',
      })
      expect(softDeleteSpy).not.toHaveBeenCalled()
    })

    it('still succeeds when moving the object to Trash fails', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping())
      jest
        .spyOn(s3ObjectMappingsRepository, 'countActiveMappingsByCid')
        .mockResolvedValue(1)
      jest
        .spyOn(ObjectUseCases, 'markAsDeleted')
        .mockResolvedValue(err(new ForbiddenError('not an owner')))
      const softDeleteSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'softDeleteMapping')
        .mockResolvedValue({ cid: 'cid123', deletedAt: new Date(5000) })

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'file.txt',
      )

      expect(result.isOk()).toBe(true)
      expect(softDeleteSpy).toHaveBeenCalled()
    })
  })

  describe('copyObject', () => {
    const source = mapping({
      bucket: 'src',
      key: 'a.txt',
      cid: 'srccid',
      md5: 'd41d8cd98f00b204e9800998ecf8427e',
    })

    beforeEach(() => {
      jest
        .spyOn(ObjectUseCases, 'authorizeDownload')
        .mockResolvedValue(ok(undefined))
    })

    it('remaps the destination to the source cid in the caller’s namespace', async () => {
      const findSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(source)
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) })

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().Cid).toBe('srccid')
      expect(result._unsafeUnwrap().ETag).toMatch(MD5_ETAG_RE)
      // Source lookup + destination creation are both scoped to the caller.
      expect(findSpy).toHaveBeenCalledWith('google', 'user1', 'src', 'a.txt')
      // Default COPY directive: the destination inherits the source metadata.
      expect(createSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        null,
        source.metadata,
      )
    })

    it('returns a not-found error when the caller has no such source key', async () => {
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue(null)

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'missing.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('refuses to copy a source that is not downloadable (removed/banned)', async () => {
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue(source)
      jest
        .spyOn(ObjectUseCases, 'authorizeDownload')
        .mockResolvedValue(err(new ObjectNotFoundError('Object not found')))
      const createSpy = jest.spyOn(s3ObjectMappingsRepository, 'createMapping')

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isErr()).toBe(true)
      expect(createSpy).not.toHaveBeenCalled()
    })

    it('inherits the source mtime when no override is given', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ ...source, mtime: '111.5' }))
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) })

      await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(createSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        '111.5',
        source.metadata,
      )
    })

    it('applies an mtime override on the destination (SetModTime)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ ...source, mtime: '111.5' }))
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) })

      await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
        Mtime: '222.9',
      })

      expect(createSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        '222.9',
        source.metadata,
      )
    })

    it('clears the destination mtime when an explicit null is given (REPLACE, no mtime)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ ...source, mtime: '111.5' }))
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) })

      await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
        Mtime: null,
      })

      expect(createSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        null,
        source.metadata,
      )
    })

    it('inherits the source metadata under the default COPY directive', async () => {
      const srcMeta = { contentType: 'text/csv', userMetadata: { a: '1' } }
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ ...source, metadata: srcMeta }))
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) })

      await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(createSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        null,
        srcMeta,
      )
    })

    it('replaces the destination metadata when the REPLACE directive provides it', async () => {
      const srcMeta = { contentType: 'text/csv' }
      const replacement = {
        contentType: 'application/json',
        userMetadata: { b: '2' },
      }
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ ...source, metadata: srcMeta }))
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) })

      await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
        Metadata: replacement,
      })

      // The replacement wins over the source metadata; mtime is untouched here.
      expect(createSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        null,
        replacement,
      )
    })

    it('falls back to the CID as ETag for legacy objects without md5', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ ...source, md5: null }))
      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(mapping({ ...source, md5: null, updatedAt: new Date() }))

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result._unsafeUnwrap().ETag).toBe('"srccid"')
    })
  })

  describe('abortMultipartUpload', () => {
    it('delegates to UploadsUseCases.abortUpload and clears the stashed metadata', async () => {
      const abortSpy = jest
        .spyOn(UploadsUseCases, 'abortUpload')
        .mockResolvedValue(ok(undefined))
      const clearMetaSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'deleteMultipartMeta')
        .mockResolvedValue(undefined)

      const result = await S3UseCases.abortMultipartUpload(mockUser, 'upload123')

      expect(result.isOk()).toBe(true)
      expect(abortSpy).toHaveBeenCalledWith(mockUser, 'upload123')
      expect(clearMetaSpy).toHaveBeenCalledWith('upload123')
    })

    it('propagates a not-found error for an unknown upload id (no metadata clear)', async () => {
      jest
        .spyOn(UploadsUseCases, 'abortUpload')
        .mockResolvedValue(err(new ObjectNotFoundError('Upload not found')))
      const clearMetaSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'deleteMultipartMeta',
      )

      const result = await S3UseCases.abortMultipartUpload(mockUser, 'nope')

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
      expect(clearMetaSpy).not.toHaveBeenCalled()
    })

    it('propagates a forbidden error when the caller does not own the upload', async () => {
      jest
        .spyOn(UploadsUseCases, 'abortUpload')
        .mockResolvedValue(err(new ForbiddenError('not your upload')))

      const result = await S3UseCases.abortMultipartUpload(mockUser, 'other')

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })
  })

  describe('objectExists', () => {
    it('returns false when the caller has no such mapping', async () => {
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue(null)

      expect(
        await S3UseCases.objectExists(mockUser, 'my-bucket', 'missing.txt'),
      ).toBe(false)
    })

    it('returns true when the mapping exists and the object is not removed', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping())
      jest.spyOn(ObjectUseCases, 'isObjectDeleted').mockResolvedValue(false)

      expect(await S3UseCases.objectExists(mockUser, 'my-bucket', 'file.txt')).toBe(
        true,
      )
    })

    it('returns false when the object was removed by its owner (Trash)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ key: 'trashed.txt' }))
      jest.spyOn(ObjectUseCases, 'isObjectDeleted').mockResolvedValue(true)

      expect(
        await S3UseCases.objectExists(mockUser, 'my-bucket', 'trashed.txt'),
      ).toBe(false)
    })
  })

  describe('getObjectWriteTime', () => {
    it('returns null when the caller has no such mapping', async () => {
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue(null)

      expect(
        await S3UseCases.getObjectWriteTime(
          mockUser,
          'my-bucket',
          'missing.txt',
        ),
      ).toBeNull()
    })

    it('anchors to the version’s createdAt, not the (bump-prone) updatedAt', async () => {
      // updatedAt is bumped by soft-delete/restore without a new version, so
      // retention must use the version row's immutable createdAt.
      const writtenAt = new Date(1720000000000)
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ updatedAt: new Date(1730000000000) }))
      jest.spyOn(ObjectUseCases, 'isObjectDeleted').mockResolvedValue(false)
      jest
        .spyOn(s3ObjectMappingsRepository, 'findVersionByCid')
        .mockResolvedValue({
          bucket: 'my-bucket',
          key: 'file.txt',
          cid: 'cid123',
          md5: null,
          mtime: null,
          metadata: null,
          createdAt: writtenAt,
        })

      expect(
        await S3UseCases.getObjectWriteTime(mockUser, 'my-bucket', 'file.txt'),
      ).toEqual(writtenAt)
    })

    it('falls back to updatedAt when the key has no version row (legacy)', async () => {
      const updatedAt = new Date(1720000000000)
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping({ updatedAt }))
      jest.spyOn(ObjectUseCases, 'isObjectDeleted').mockResolvedValue(false)
      jest
        .spyOn(s3ObjectMappingsRepository, 'findVersionByCid')
        .mockResolvedValue(null)

      expect(
        await S3UseCases.getObjectWriteTime(mockUser, 'my-bucket', 'file.txt'),
      ).toEqual(updatedAt)
    })

    it('returns null when the object was removed by its owner (Trash)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping())
      jest.spyOn(ObjectUseCases, 'isObjectDeleted').mockResolvedValue(true)

      expect(
        await S3UseCases.getObjectWriteTime(mockUser, 'my-bucket', 'file.txt'),
      ).toBeNull()
    })
  })
})
