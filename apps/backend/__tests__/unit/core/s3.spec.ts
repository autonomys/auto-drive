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
import { ObjectNotFoundError } from '../../../src/errors/index.js'

/** Quoted single-object MD5 ETag: `"<32 hex chars>"` */
const MD5_ETAG_RE = /^"[a-f0-9]{32}"$/
/** Composite multipart ETag: `"<32 hex chars>-<N>"` */
const MULTIPART_ETAG_RE = /^"[a-f0-9]{32}-\d+"$/
/** Multipart MD5 as stored in the DB (no outer quotes): `<32 hex chars>-<N>` */
const MULTIPART_MD5_RE = /^[a-f0-9]{32}-\d+$/

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('S3UseCases', () => {
  const mockUser: UserWithOrganization = {
    id: 'user1',
    publicId: 'pub1',
    organizationId: 'org1',
    walletAddress: '0xuser',
  } as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getObject', () => {
    it('should return error when object mapping not found', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(null)

      const result = await S3UseCases.getObject({
        Bucket: 'my-bucket',
        Key: 'nonexistent/file.txt',
      } as any)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('should return error from download use case', async () => {
      const mapping = {
        bucket: 'my-bucket',
        key: 'file.txt',
        cid: 'cid123',
        md5: 'abc123',
      }
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping as any)

      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(
          err(new ObjectNotFoundError('Download failed')) as any,
        )

      const result = await S3UseCases.getObject({
        Bucket: 'my-bucket',
        Key: 'file.txt',
      } as any)

      expect(result.isErr()).toBe(true)
    })

    it('should return download result with cid and etag', async () => {
      const mapping = {
        bucket: 'my-bucket',
        key: 'file.txt',
        cid: 'cid123',
        md5: 'abc123def456abc123def456abc123de',
      }
      const mockReadable = { read: jest.fn() }

      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping as any)

      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok(mockReadable) as any)

      const result = await S3UseCases.getObject({
        Bucket: 'my-bucket',
        Key: 'file.txt',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().cid).toBe('cid123')
      expect(result._unsafeUnwrap().etag).toBe(
        '"abc123def456abc123def456abc123de"',
      )
    })

    it('should return null etag for legacy objects without md5', async () => {
      const mapping = {
        bucket: 'my-bucket',
        key: 'file.txt',
        cid: 'cid123',
        md5: null,
      }

      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping as any)

      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok({} as any) as any)

      const result = await S3UseCases.getObject({
        Bucket: 'my-bucket',
        Key: 'file.txt',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().etag).toBeNull()
    })

    it('should pass byte range to download use case', async () => {
      const mapping = {
        bucket: 'my-bucket',
        key: 'file.txt',
        cid: 'cid123',
        md5: null,
      }
      const downloadSpy = jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok({} as any) as any)

      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping as any)

      await S3UseCases.getObject({
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
    it('should create multipart upload', async () => {
      const createSpy = jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)

      const result = await S3UseCases.createMultipartUpload(mockUser, {
        Bucket: 'bucket',
        Key: 'file.txt',
        ContentType: 'text/plain',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(createSpy).toHaveBeenCalled()
    })
  })

  describe('uploadPart', () => {
    it('should upload part and return MD5 ETag', async () => {
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
    it('should complete multipart upload and return composite ETag', async () => {
      const completeSpy = jest
        .spyOn(UploadsUseCases, 'completeUpload')
        .mockResolvedValue('cid123')

      const mappingSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({
          bucket: 'my-bucket',
          key: 'file.txt',
          cid: 'cid123',
          md5: null,
        } as any)

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
      // Composite ETag: "<md5>-N" format
      expect(result._unsafeUnwrap().ETag).toMatch(MULTIPART_ETAG_RE)
      expect(result._unsafeUnwrap().Cid).toBe('cid123')
      expect(mappingSpy).toHaveBeenCalledWith(
        'my-bucket',
        'file.txt',
        'cid123',
        expect.stringMatching(MULTIPART_MD5_RE),
      )
    })
  })

  describe('putObject', () => {
    it('should put object and return MD5 ETag with CID', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)

      jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockResolvedValue(ok({} as any) as any)

      jest.spyOn(UploadsUseCases, 'completeUpload').mockResolvedValue('cid123')

      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({
          bucket: 'my-bucket',
          key: 'file.txt',
          cid: 'cid123',
          md5: 'd41d8cd98f00b204e9800998ecf8427e',
        } as any)

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

    it('should extract filename from path', async () => {
      const createSpy = jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)

      jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockResolvedValue(ok({} as any) as any)

      jest.spyOn(UploadsUseCases, 'completeUpload').mockResolvedValue('cid123')

      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({
          bucket: 'my-bucket',
          key: 'path/file.txt',
          cid: 'cid123',
          md5: null,
        } as any)

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

    it('should handle upload chunk errors', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)

      jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockRejectedValue(new Error('Upload failed'))

      jest.spyOn(UploadsUseCases, 'completeUpload').mockResolvedValue('cid123')

      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({
          bucket: 'my-bucket',
          key: 'file.txt',
          cid: 'cid123',
          md5: null,
        } as any)

      const result = await S3UseCases.putObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
        Body: Buffer.from('data'),
      } as any)

      expect(result.isErr()).toBe(true)
    })

    it('should pass MD5 to createMapping', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)

      jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockResolvedValue(ok({} as any) as any)

      jest.spyOn(UploadsUseCases, 'completeUpload').mockResolvedValue('cid123')

      const mappingSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({
          bucket: 'my-bucket',
          key: 'file.txt',
          cid: 'cid123',
          md5: null,
        } as any)

      const body = Buffer.from('Hello, world!')
      await S3UseCases.putObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'file.txt',
        Body: body,
      } as any)

      // MD5 of "Hello, world!" — verified with: echo -n "Hello, world!" | md5
      expect(mappingSpy).toHaveBeenCalledWith(
        'my-bucket',
        'file.txt',
        'cid123',
        '6cd3556deb0da54bca060b4c39479839',
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

    it('advances continuation token past a folded CommonPrefix when the DB batch is exhausted inside one prefix group', async () => {
      // Regression test for Cursor Bugbot finding on PR #696 / #709.
      //
      // Scenario: maxKeys=2, delimiter='/', and a single virtual directory
      // ('big/') contains more keys than fit in one DB batch.  Every fetched
      // row folds into the same CommonPrefix, so the in-loop maxKeys cap is
      // never hit and the loop exhausts the batch with isTruncated=false.
      // The fallback branch must then set the continuation token to a value
      // that sorts *after* every key in 'big/' — otherwise the next page
      // re-scans the rest of that directory and emits 'big/' again.
      const maxKeys = 2
      const dbLimit = DELIMITER_DB_LIMIT(maxKeys)

      // Fill the entire DB batch with keys that all fold into 'big/'.
      const fullBatch = Array.from({ length: dbLimit }, (_, i) =>
        makeListing(`big/${String(i).padStart(6, '0')}`),
      )

      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjects')
        .mockResolvedValue(fullBatch as any)

      const result = await S3UseCases.listObjects({
        bucket: 'my-bucket',
        prefix: '',
        delimiter: '/',
        maxKeys,
        continuationToken: null,
      })

      expect(result.commonPrefixes).toEqual(['big/'])
      expect(result.objects).toEqual([])
      expect(result.isTruncated).toBe(true)
      // Token must start with the folded prefix and sort strictly after every
      // key inside it.  `￿` (U+FFFF) is the sentinel chosen for this purpose.
      expect(result.nextContinuationToken).toBe('big/￿')
      // Sanity: the token sorts after the last key we returned in the batch.
      expect(
        result.nextContinuationToken! > fullBatch[fullBatch.length - 1].key,
      ).toBe(true)
    })

    it('uses the raw last key as the token when the last scanned key did not fold into a prefix', async () => {
      // If the DB batch is full but the last key has no delimiter occurrence
      // after the prefix, there's no CommonPrefix to skip past — fall back to
      // the raw last key, which is the safe pre-fix behaviour.
      const maxKeys = 2
      const dbLimit = DELIMITER_DB_LIMIT(maxKeys)

      // Pad the batch with folded entries, but make the LAST one a top-level
      // key with no delimiter after the prefix.
      const batch = [
        ...Array.from({ length: dbLimit - 1 }, (_, i) =>
          makeListing(`folder/${String(i).padStart(6, '0')}`),
        ),
        makeListing('zzz-top-level'),
      ]

      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjects')
        .mockResolvedValue(batch as any)

      const result = await S3UseCases.listObjects({
        bucket: 'my-bucket',
        prefix: '',
        delimiter: '/',
        maxKeys,
        continuationToken: null,
      })

      expect(result.isTruncated).toBe(true)
      // The last key doesn't fold into a CommonPrefix, so the token stays as
      // the raw key — no sentinel needed.
      expect(result.nextContinuationToken).toBe('zzz-top-level')
    })

    it('uses the raw last key as the token when no delimiter is set', async () => {
      // Without a delimiter, the dbLimit is maxKeys + 1, and there are no
      // CommonPrefixes to repeat — the safe fallback is just the last key.
      const maxKeys = 2
      const dbLimit = maxKeys + 1 // = 3

      const batch = [
        makeListing('a.txt'),
        makeListing('b.txt'),
        makeListing('c.txt'),
      ]

      jest
        .spyOn(s3ObjectMappingsRepository, 'listObjects')
        .mockResolvedValue(batch as any)

      const result = await S3UseCases.listObjects({
        bucket: 'my-bucket',
        prefix: '',
        delimiter: null,
        maxKeys,
        continuationToken: null,
      })

      // maxKeys=2 ⇒ first two keys returned, third triggers truncation in
      // buildListResult (not the fallback), token = key just returned.
      expect(result.objects.map((o) => o.key)).toEqual(['a.txt', 'b.txt'])
      expect(result.isTruncated).toBe(true)
      expect(result.nextContinuationToken).toBe('b.txt')
      // dbLimit branch shouldn't have triggered, so no sentinel appended.
      expect(batch.length).toBe(dbLimit)
    })
  })

  describe('objectExists', () => {
    it('returns false when no mapping exists', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(null)

      expect(await S3UseCases.objectExists('my-bucket', 'missing.txt')).toBe(
        false,
      )
    })

    it('returns true when a mapping exists and the object is not deleted', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue({
          bucket: 'my-bucket',
          key: 'file.txt',
          cid: 'cid123',
          md5: null,
        } as any)
      jest.spyOn(ObjectUseCases, 'isObjectDeleted').mockResolvedValue(false)

      expect(await S3UseCases.objectExists('my-bucket', 'file.txt')).toBe(true)
    })

    // A trashed object keeps its mapping row but is hidden from GET/list, so
    // object-lock endpoints must report it as not found too.
    it('returns false when the mapping exists but the object was removed by its owner', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue({
          bucket: 'my-bucket',
          key: 'trashed.txt',
          cid: 'cid123',
          md5: null,
        } as any)
      jest.spyOn(ObjectUseCases, 'isObjectDeleted').mockResolvedValue(true)

      expect(await S3UseCases.objectExists('my-bucket', 'trashed.txt')).toBe(
        false,
      )
    })
  })
})
