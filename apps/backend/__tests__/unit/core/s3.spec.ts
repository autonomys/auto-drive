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
import { UserWithOrganization } from '@auto-drive/models'
import { ok, err } from 'neverthrow'
import { ObjectNotFoundError } from '../../../src/errors/index.js'

const MD5_REGEX = /^"[a-f0-9]{32}"$/

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
      expect(result._unsafeUnwrap().ETag).toMatch(MD5_REGEX)
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
      // Composite ETag: "<md5>-2" format
      expect(result._unsafeUnwrap().ETag).toMatch(/^"[a-f0-9]{32}-2"$/)
      expect(result._unsafeUnwrap().Cid).toBe('cid123')
      expect(mappingSpy).toHaveBeenCalledWith(
        'my-bucket',
        'file.txt',
        'cid123',
        expect.stringMatching(/^[a-f0-9]{32}-2$/),
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
      expect(result._unsafeUnwrap().ETag).toMatch(MD5_REGEX)
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
})
