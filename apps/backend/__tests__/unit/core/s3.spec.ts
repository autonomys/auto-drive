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
        Key: 'nonexistent/file.txt',
      } as any)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('should return error from download use case', async () => {
      const mapping = { key: 'file.txt', cid: 'cid123' }
      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping as any)

      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(
          err(new ObjectNotFoundError('Download failed')) as any,
        )

      const result = await S3UseCases.getObject({
        Key: 'file.txt',
      } as any)

      expect(result.isErr()).toBe(true)
    })

    it('should return download result successfully', async () => {
      const mapping = { key: 'file.txt', cid: 'cid123' }
      const mockReadable = { read: jest.fn() }

      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping as any)

      jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok(mockReadable) as any)

      const result = await S3UseCases.getObject({
        Key: 'file.txt',
      } as any)

      expect(result.isOk()).toBe(true)
    })

    it('should pass byte range to download use case', async () => {
      const mapping = { key: 'file.txt', cid: 'cid123' }
      const downloadSpy = jest
        .spyOn(DownloadUseCase, 'downloadObjectByAnonymous')
        .mockResolvedValue(ok({} as any) as any)

      jest
        .spyOn(s3ObjectMappingsRepository, 'findByKey')
        .mockResolvedValue(mapping as any)

      await S3UseCases.getObject({
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
    it('should upload part successfully', async () => {
      const uploadChunkSpy = jest
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
      expect(uploadChunkSpy).toHaveBeenCalled()
    })
  })

  describe('completeMultipartUpload', () => {
    it('should complete multipart upload and create mapping', async () => {
      const completeSpy = jest
        .spyOn(UploadsUseCases, 'completeUpload')
        .mockResolvedValue('cid123')

      const mappingSpy = jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ key: 'file.txt', cid: 'cid123' } as any)

      const result = await S3UseCases.completeMultipartUpload(mockUser, {
        Bucket: 'bucket',
        Key: 'file.txt',
        UploadId: 'upload123',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(completeSpy).toHaveBeenCalledWith(mockUser, 'upload123')
      expect(mappingSpy).toHaveBeenCalledWith('file.txt', 'cid123')
    })
  })

  describe('putObject', () => {
    it('should put object successfully', async () => {
      const createSpy = jest
        .spyOn(UploadsUseCases, 'createFileUpload')
        .mockResolvedValue({ id: 'upload123' } as any)

      const uploadChunkSpy = jest
        .spyOn(UploadsUseCases, 'uploadChunk')
        .mockResolvedValue(ok({} as any) as any)

      const completeSpy = jest
        .spyOn(UploadsUseCases, 'completeUpload')
        .mockResolvedValue('cid123')

      jest
        .spyOn(s3ObjectMappingsRepository, 'createMapping')
        .mockResolvedValue({ key: 'file.txt', cid: 'cid123' } as any)

      const result = await S3UseCases.putObject(mockUser, {
        Bucket: 'bucket',
        Key: 'path/file.txt',
        Body: Buffer.from('data'),
        ContentType: 'text/plain',
      } as any)

      expect(result.isOk()).toBe(true)
      expect(createSpy).toHaveBeenCalled()
      expect(uploadChunkSpy).toHaveBeenCalled()
      expect(completeSpy).toHaveBeenCalled()
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
        .mockResolvedValue({ key: 'deep/path/file.txt', cid: 'cid123' } as any)

      await S3UseCases.putObject(mockUser, {
        Bucket: 'bucket',
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
        .mockResolvedValue({ key: 'file.txt', cid: 'cid123' } as any)

      const result = await S3UseCases.putObject(mockUser, {
        Bucket: 'bucket',
        Key: 'file.txt',
        Body: Buffer.from('data'),
      } as any)

      expect(result.isErr()).toBe(true)
    })
  })
})
