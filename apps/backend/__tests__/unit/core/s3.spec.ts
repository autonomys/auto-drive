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
  })

  describe('createMultipartUpload', () => {
    it('creates the upload; stashes no mtime when none is supplied', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)
      const mtimeSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'setMultipartMtime',
      )

      const result = await S3UseCases.createMultipartUpload(mockUser, {
        Bucket: 'bucket',
        Key: 'file.txt',
        ContentType: 'text/plain',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(mtimeSpy).not.toHaveBeenCalled()
    })

    it('stashes the client mtime by upload id when provided', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)
      const mtimeSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'setMultipartMtime')
        .mockResolvedValue(undefined)

      await S3UseCases.createMultipartUpload(mockUser, {
        Bucket: 'bucket',
        Key: 'file.txt',
        Mtime: '1620000000.5',
      } as any)

      expect(mtimeSpy).toHaveBeenCalledWith('upload123', '1620000000.5')
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
    it('completes the upload, persists the composite ETag + stashed mtime under the caller', async () => {
      const completeSpy = jest
        .spyOn(UploadsUseCases, 'completeUpload')
        .mockResolvedValue('cid123')
      const mappingSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(mapping())
      jest
        .spyOn(s3ObjectMappingsRepository, 'getMultipartMtime')
        .mockResolvedValue('1620000000.5')
      const clearMtimeSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'deleteMultipartMtime')
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
      // createMapping is owner-scoped: (owner, owner, bucket, key, cid, md5, mtime).
      expect(mappingSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'my-bucket',
        'file.txt',
        'cid123',
        expect.stringMatching(MULTIPART_MD5_RE),
        '1620000000.5',
      )
      expect(clearMtimeSpy).toHaveBeenCalledWith('upload123')
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

      // MD5 of "Hello, world!"; owner-scoped (owner, owner, bucket, key, cid, md5, mtime).
      expect(mappingSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'my-bucket',
        'file.txt',
        'cid123',
        '6cd3556deb0da54bca060b4c39479839',
        null,
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
        .mockResolvedValue({ cid: 'cid123' })

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'file.txt',
      )

      expect(result.isOk()).toBe(true)
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
        .mockResolvedValue({ cid: 'cid123' })

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
        .mockResolvedValue({ cid: 'cid123' })

      const result = await S3UseCases.deleteObject(mockUser, 'my-bucket', 'k2.txt')

      expect(result.isOk()).toBe(true)
      expect(markSpy).toHaveBeenCalledWith(mockUser, 'cid123')
    })

    it('is a no-op when the caller has no such key', async () => {
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue(null)
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
      expect(softDeleteSpy).not.toHaveBeenCalled()
      expect(markSpy).not.toHaveBeenCalled()
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
        .mockResolvedValue({ cid: 'cid123' })

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
      expect(createSpy).toHaveBeenCalledWith(
        'google',
        'user1',
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        null,
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
    it('delegates to UploadsUseCases.abortUpload and clears the stashed mtime', async () => {
      const abortSpy = jest
        .spyOn(UploadsUseCases, 'abortUpload')
        .mockResolvedValue(ok(undefined))
      const clearMtimeSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'deleteMultipartMtime')
        .mockResolvedValue(undefined)

      const result = await S3UseCases.abortMultipartUpload(mockUser, 'upload123')

      expect(result.isOk()).toBe(true)
      expect(abortSpy).toHaveBeenCalledWith(mockUser, 'upload123')
      expect(clearMtimeSpy).toHaveBeenCalledWith('upload123')
    })

    it('propagates a not-found error for an unknown upload id (no mtime clear)', async () => {
      jest
        .spyOn(UploadsUseCases, 'abortUpload')
        .mockResolvedValue(err(new ObjectNotFoundError('Upload not found')))
      const clearMtimeSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'deleteMultipartMtime',
      )

      const result = await S3UseCases.abortMultipartUpload(mockUser, 'nope')

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
      expect(clearMtimeSpy).not.toHaveBeenCalled()
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
})
