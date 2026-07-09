import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { S3UseCases } from '../../../src/core/s3/index.js'
import {
  ownershipRepository,
  s3ObjectMappingsRepository,
} from '../../../src/infrastructure/repositories/index.js'
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
  const mockUser: UserWithOrganization = {
    id: 'user1',
    publicId: 'pub1',
    organizationId: 'org1',
    walletAddress: '0xuser',
    oauthProvider: 'google',
    oauthUserId: 'user1',
  } as any

  // An ownership row for mockUser (the S3 uploader), used to satisfy
  // deleteObject's owner gate.
  const ownerRow = {
    cid: 'cid123',
    oauth_provider: 'google',
    oauth_user_id: 'user1',
    is_admin: true,
    marked_as_deleted: null,
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
      expect(createSpy).toHaveBeenCalled()
      // No mtime supplied → nothing stashed.
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
      // mtime stashed at CreateMultipartUpload; persisted then cleared here.
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
      // Composite ETag: "<md5>-N" format
      expect(result._unsafeUnwrap().ETag).toMatch(MULTIPART_ETAG_RE)
      expect(result._unsafeUnwrap().Cid).toBe('cid123')
      // Args after the md5: mtime (stashed), then the owner (uploading user).
      expect(mappingSpy).toHaveBeenCalledWith(
        'my-bucket',
        'file.txt',
        'cid123',
        expect.stringMatching(MULTIPART_MD5_RE),
        '1620000000.5',
        'google',
        'user1',
      )
      expect(clearMtimeSpy).toHaveBeenCalledWith('upload123')
    })

    it('rejects completing onto a key owned by another user (Forbidden)', async () => {
      jest.spyOn(UploadsUseCases, 'completeUpload').mockResolvedValue('cid123')
      jest
        .spyOn(s3ObjectMappingsRepository, 'getMultipartMtime')
        .mockResolvedValue(null)
      jest
        .spyOn(s3ObjectMappingsRepository, 'deleteMultipartMtime')
        .mockResolvedValue(undefined)
      // Cross-owner conflict → the guarded upsert returns null.
      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(null)

      const result = await S3UseCases.completeMultipartUpload(mockUser, {
        Bucket: 'my-bucket',
        Key: 'victim.txt',
        UploadId: 'upload123',
        Parts: [{ PartNumber: 1, ETag: '"aabbccdd11223344aabbccdd11223344"' }],
      } as any)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
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

      // MD5 of "Hello, world!" — verified with: echo -n "Hello, world!" | md5.
      // Args after the md5: mtime (null — none supplied), then the owner.
      expect(mappingSpy).toHaveBeenCalledWith(
        'my-bucket',
        'file.txt',
        'cid123',
        '6cd3556deb0da54bca060b4c39479839',
        null,
        'google',
        'user1',
      )
    })

    it('rejects overwriting a key owned by another user (Forbidden)', async () => {
      jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)
      jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockResolvedValue(ok({} as any) as any)
      jest.spyOn(UploadsUseCases, 'completeUpload').mockResolvedValue('cid123')
      // Cross-owner conflict → the guarded upsert returns null.
      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(null)

      const result = await S3UseCases.putObject(mockUser, {
        Bucket: 'my-bucket',
        Key: 'victim.txt',
        Body: Buffer.from('data'),
      } as any)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
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

  describe('deleteObject', () => {
    // Legacy mapping (no recorded owner) → the delete gate falls back to the
    // per-CID admin check.
    const activeMapping = {
      bucket: 'my-bucket',
      key: 'file.txt',
      cid: 'cid123',
      md5: null,
      mtime: null,
      ownerOauthProvider: null,
      ownerOauthUserId: null,
    } as any

    // Modern mapping owned by mockUser → gated on the per-mapping owner.
    const ownedMapping = {
      ...activeMapping,
      ownerOauthProvider: 'google',
      ownerOauthUserId: 'user1',
    } as any

    it('trashes the object then hides the mapping when it was the last reference', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(activeMapping)
      jest
        .spyOn(ownershipRepository, 'getOwnerships')
        .mockResolvedValue([ownerRow])
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
      // Last active mapping → propagate to Trash, then hide the key.
      expect(markSpy).toHaveBeenCalledWith(mockUser, 'cid123')
      expect(softDeleteSpy).toHaveBeenCalledWith('my-bucket', 'file.txt')
    })

    it('does not trash the object when another S3 key still references it', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue({ ...activeMapping, key: 'copy.txt' })
      jest
        .spyOn(ownershipRepository, 'getOwnerships')
        .mockResolvedValue([ownerRow])
      // Before-hide count = 2 (this + sibling); after-hide re-check = 1 (sibling
      // still active), so the race guard does not trash.
      jest
        .spyOn(s3ObjectMappingsRepository, 'countActiveMappingsByCid')
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
      const markSpy = jest
        .spyOn(ObjectUseCases, 'markAsDeleted')
        .mockResolvedValue(ok(undefined))
      const softDeleteSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'softDeleteMapping')
        .mockResolvedValue({ cid: 'cid123' })

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'copy.txt',
      )

      expect(result.isOk()).toBe(true)
      // A sibling key (e.g. the move source) keeps the content live.
      expect(markSpy).not.toHaveBeenCalled()
      expect(softDeleteSpy).toHaveBeenCalledWith('my-bucket', 'copy.txt')
    })

    it('trashes via the race guard when a concurrent delete removed the sibling', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue({ ...activeMapping, key: 'k2.txt' })
      jest
        .spyOn(ownershipRepository, 'getOwnerships')
        .mockResolvedValue([ownerRow])
      // Before-hide count = 2 (a concurrent delete's key still looked active),
      // but the after-hide re-check sees 0 → this delete emptied the content and
      // must trash the object.
      jest
        .spyOn(s3ObjectMappingsRepository, 'countActiveMappingsByCid')
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
      const markSpy = jest
        .spyOn(ObjectUseCases, 'markAsDeleted')
        .mockResolvedValue(ok(undefined))
      const softDeleteSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'softDeleteMapping')
        .mockResolvedValue({ cid: 'cid123' })

      const result = await S3UseCases.deleteObject(mockUser, 'my-bucket', 'k2.txt')

      expect(result.isOk()).toBe(true)
      expect(softDeleteSpy).toHaveBeenCalledWith('my-bucket', 'k2.txt')
      // Race guard caught the emptied content and moved it to Trash.
      expect(markSpy).toHaveBeenCalledWith(mockUser, 'cid123')
    })

    it('is a no-op when the key is absent or already deleted', async () => {
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue(null)
      const ownSpy = jest.spyOn(ownershipRepository, 'getOwnerships')
      const softDeleteSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'softDeleteMapping',
      )

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'missing.txt',
      )

      expect(result.isOk()).toBe(true)
      expect(ownSpy).not.toHaveBeenCalled()
      expect(softDeleteSpy).not.toHaveBeenCalled()
    })

    it('does not hide the key when the caller does not own the content', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(activeMapping)
      // Owned (admin) by someone else.
      jest
        .spyOn(ownershipRepository, 'getOwnerships')
        .mockResolvedValue([
          { ...ownerRow, oauth_user_id: 'someone-else' },
        ])
      const softDeleteSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'softDeleteMapping',
      )
      const markSpy = jest.spyOn(ObjectUseCases, 'markAsDeleted')

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'file.txt',
      )

      // Idempotent success, but the non-owner cannot hide the key.
      expect(result.isOk()).toBe(true)
      expect(softDeleteSpy).not.toHaveBeenCalled()
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('does not hide the key for a shared (non-admin) recipient', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(activeMapping)
      // The caller is an active owner, but a VIEWER (share recipient), not the
      // admin owner — they must not be able to hide the key for everyone.
      jest
        .spyOn(ownershipRepository, 'getOwnerships')
        .mockResolvedValue([{ ...ownerRow, is_admin: false }])
      const softDeleteSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'softDeleteMapping',
      )
      const markSpy = jest.spyOn(ObjectUseCases, 'markAsDeleted')

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'file.txt',
      )

      expect(result.isOk()).toBe(true)
      expect(softDeleteSpy).not.toHaveBeenCalled()
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('still succeeds when moving the object to Trash fails', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(activeMapping)
      jest
        .spyOn(ownershipRepository, 'getOwnerships')
        .mockResolvedValue([ownerRow])
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

      // The key is still hidden; a Trash-propagation failure must not fail the
      // S3 DeleteObject.
      expect(result.isOk()).toBe(true)
      expect(softDeleteSpy).toHaveBeenCalledWith('my-bucket', 'file.txt')
    })

    it('gates on the per-mapping owner (no per-CID lookup) and scopes the count', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(ownedMapping)
      const getOwnershipsSpy = jest.spyOn(ownershipRepository, 'getOwnerships')
      const countSpy = jest
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
      // Owner is known from the mapping → no CID-ownership lookup needed.
      expect(getOwnershipsSpy).not.toHaveBeenCalled()
      // The "last key" count is scoped to the caller, not the whole CID.
      expect(countSpy).toHaveBeenCalledWith('cid123', 'google', 'user1')
      expect(markSpy).toHaveBeenCalledWith(mockUser, 'cid123')
      expect(softDeleteSpy).toHaveBeenCalledWith('my-bucket', 'file.txt')
    })

    it('refuses to hide another user’s key even from a dedup co-owner of the CID', async () => {
      // The mapping belongs to someone else; the caller (mockUser) may well be
      // an admin owner of the same CID via dedup, but that must NOT let them
      // hide this key. The per-mapping owner check never consults CID ownership.
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue({ ...ownedMapping, ownerOauthUserId: 'someone-else' })
      const getOwnershipsSpy = jest.spyOn(ownershipRepository, 'getOwnerships')
      const softDeleteSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'softDeleteMapping',
      )
      const markSpy = jest.spyOn(ObjectUseCases, 'markAsDeleted')

      const result = await S3UseCases.deleteObject(
        mockUser,
        'my-bucket',
        'file.txt',
      )

      expect(result.isOk()).toBe(true)
      expect(getOwnershipsSpy).not.toHaveBeenCalled()
      expect(softDeleteSpy).not.toHaveBeenCalled()
      expect(markSpy).not.toHaveBeenCalled()
    })
  })

  describe('copyObject', () => {
    const source = {
      bucket: 'src',
      key: 'a.txt',
      cid: 'srccid',
      md5: 'd41d8cd98f00b204e9800998ecf8427e',
      mtime: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }

    beforeEach(() => {
      // Happy-path defaults: caller is the active admin owner and the source is
      // readable.
      jest
        .spyOn(ownershipRepository, 'getOwnerships')
        .mockResolvedValue([ownerRow])
      jest
        .spyOn(ObjectUseCases, 'authorizeDownload')
        .mockResolvedValue(ok(undefined))
    })

    it('remaps the destination to the source cid (no ownership re-grant)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(source as any)
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) } as any)

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().Cid).toBe('srccid')
      expect(result._unsafeUnwrap().ETag).toMatch(MD5_ETAG_RE)
      // Destination points at the SAME cid + md5 as the source, owned by the
      // copier (args after md5: mtime, owner provider, owner user id).
      expect(createSpy).toHaveBeenCalledWith(
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        null,
        'google',
        'user1',
      )
    })

    it('returns a not-found error when the source is missing (NoSuchKey)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(null)

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'missing.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('refuses to copy a source the caller does not own (NoSuchKey, no mapping)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(source as any)
      // Owned (admin) by a different user.
      jest
        .spyOn(ownershipRepository, 'getOwnerships')
        .mockResolvedValue([{ ...ownerRow, oauth_user_id: 'someone-else' }])
      const createSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'createMapping',
      )

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
      // A non-owner can't acquire the CID via copy.
      expect(createSpy).not.toHaveBeenCalled()
    })

    it('refuses to copy for a shared (non-admin) recipient', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(source as any)
      // Caller is an active owner, but only a VIEWER (share recipient).
      jest
        .spyOn(ownershipRepository, 'getOwnerships')
        .mockResolvedValue([{ ...ownerRow, is_admin: false }])
      const createSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'createMapping',
      )

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isErr()).toBe(true)
      expect(createSpy).not.toHaveBeenCalled()
    })

    it('gates the source on its per-mapping owner without a CID lookup', async () => {
      // Modern source owned by the caller → authorized via the mapping owner;
      // the per-CID ownership lookup is not consulted (matches deleteObject).
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue({
        ...source,
        ownerOauthProvider: 'google',
        ownerOauthUserId: 'user1',
      } as any)
      const getOwnershipsSpy = jest.spyOn(ownershipRepository, 'getOwnerships')
      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) } as any)

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isOk()).toBe(true)
      expect(getOwnershipsSpy).not.toHaveBeenCalled()
    })

    it('refuses to copy from a source key owned by another user (dedup co-owner)', async () => {
      // The source key belongs to someone else. The caller may co-own the CID
      // via dedup (identical bytes), but must NOT be able to use another user's
      // key as a copy source — mirrors deleteObject's per-mapping-owner gate.
      jest.spyOn(s3ObjectMappingsRepository, 'findByKey').mockResolvedValue({
        ...source,
        ownerOauthProvider: 'google',
        ownerOauthUserId: 'someone-else',
      } as any)
      const getOwnershipsSpy = jest.spyOn(ownershipRepository, 'getOwnerships')
      const createSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'createMapping',
      )

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
      // Modern source → owner from the mapping; no CID-ownership lookup, and no
      // destination mapping created.
      expect(getOwnershipsSpy).not.toHaveBeenCalled()
      expect(createSpy).not.toHaveBeenCalled()
    })

    it('refuses to copy a source that is not downloadable (removed/banned)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(source as any)
      jest
        .spyOn(ObjectUseCases, 'authorizeDownload')
        .mockResolvedValue(err(new ObjectNotFoundError('Object not found')))
      const createSpy = jest.spyOn(
        s3ObjectMappingsRepository,
        'createMapping',
      )

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
      // No destination mapping is created for an unreadable source.
      expect(createSpy).not.toHaveBeenCalled()
    })

    it('inherits the source mtime when no override is provided', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue({ ...source, mtime: '111.5' } as any)
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) } as any)

      await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(createSpy).toHaveBeenCalledWith(
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        '111.5',
        'google',
        'user1',
      )
    })

    it('applies an mtime override on the destination (SetModTime)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue({ ...source, mtime: '111.5' } as any)
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) } as any)

      await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
        Mtime: '222.9',
      })

      expect(createSpy).toHaveBeenCalledWith(
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        '222.9',
        'google',
        'user1',
      )
    })

    it('clears the destination mtime when an explicit null is given (REPLACE, no mtime)', async () => {
      // A metadata-REPLACE copy with no x-amz-meta-mtime resolves to Mtime: null
      // in the controller; the use case must write null (clear), not inherit the
      // source's mtime.
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue({ ...source, mtime: '111.5' } as any)
      const createSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, updatedAt: new Date(1000) } as any)

      await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
        Mtime: null,
      })

      expect(createSpy).toHaveBeenCalledWith(
        'dst',
        'b.txt',
        'srccid',
        source.md5,
        null,
        'google',
        'user1',
      )
    })

    it('falls back to the CID as ETag for legacy objects without md5', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue({ ...source, md5: null } as any)
      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ ...source, md5: null, updatedAt: new Date() } as any)

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'b.txt',
      })

      expect(result._unsafeUnwrap().ETag).toBe('"srccid"')
    })

    it('rejects copying onto a destination key owned by another user (Forbidden)', async () => {
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(source as any)
      // Caller owns the source (beforeEach getOwnerships → ownerRow); the
      // destination key is owned by someone else → guarded upsert returns null.
      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue(null)

      const result = await S3UseCases.copyObject(mockUser, {
        SourceBucket: 'src',
        SourceKey: 'a.txt',
        Bucket: 'dst',
        Key: 'victim.txt',
      })

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
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

      const result = await S3UseCases.abortMultipartUpload(
        mockUser,
        'upload123',
      )

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
      // A failed abort must not drop another upload's stashed mtime.
      expect(clearMtimeSpy).not.toHaveBeenCalled()
    })

    it('propagates a forbidden error when the caller does not own the upload', async () => {
      jest
        .spyOn(UploadsUseCases, 'abortUpload')
        .mockResolvedValue(err(new ForbiddenError('not your upload')))

      const result = await S3UseCases.abortMultipartUpload(mockUser, 'other')

      // The controller maps ForbiddenError → 403 AccessDenied (not 500).
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })
  })
})
