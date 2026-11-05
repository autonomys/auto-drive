import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { Request, Response } from 'express'
import { ok } from 'neverthrow'
import {
  CUSTOMER_REFERENCE_REGEX,
  uploadOptionsSchema,
  UploadType,
  UploadStatus,
} from '@auto-drive/models'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { fileProcessingInfoRepository } from '../../../src/infrastructure/repositories/uploads/fileProcessingInfo.js'
import { interactionsRepository } from '../../../src/infrastructure/repositories/objects/interactions.js'
import {
  putObjectHandler,
  createMultipartUploadHandler,
} from '../../../src/app/controllers/s3/s3.js'
import { S3UseCases } from '../../../src/core/s3/index.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { createMockUser } from '../../utils/mocks.js'

describe('Customer Reference on Uploads (#892)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest
      .spyOn(fileProcessingInfoRepository, 'addFileProcessingInfo')
      .mockResolvedValue(undefined as never)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('CUSTOMER_REFERENCE_REGEX and schema validation', () => {
    it('accepts valid alphanumeric and allowed punctuation references', () => {
      const validCases = [
        'customer-123',
        'cust_user.456:tenant',
        'a',
        'A',
        '0',
        '-',
        '_',
        '.',
        ':',
        'TENANT-A_user.123:org-999',
        'x'.repeat(128),
      ]

      for (const ref of validCases) {
        expect(CUSTOMER_REFERENCE_REGEX.test(ref)).toBe(true)
        const parseResult = uploadOptionsSchema.safeParse({
          customerReference: ref,
        })
        expect(parseResult.success).toBe(true)
      }
    })

    it('rejects references exceeding 128 characters', () => {
      const tooLong = 'a'.repeat(129)
      expect(CUSTOMER_REFERENCE_REGEX.test(tooLong)).toBe(false)

      const parseResult = uploadOptionsSchema.safeParse({
        customerReference: tooLong,
      })
      expect(parseResult.success).toBe(false)
      if (!parseResult.success) {
        expect(parseResult.error.issues[0].message).toContain(
          'Invalid customer reference',
        )
      }
    })

    it('rejects references with invalid characters (spaces, slashes, symbols)', () => {
      const invalidCases = [
        'cust 123',
        'cust/123',
        'cust@domain',
        'cust#id',
        'cust$val',
        'cust%1',
        'cust^2',
        'cust&3',
        'cust*4',
        'cust(5)',
        'cust+6',
        'cust=7',
        'cust~8',
        'cust`9',
        'cust!0',
        'cust?ref',
        'cust<1>',
      ]

      for (const ref of invalidCases) {
        expect(CUSTOMER_REFERENCE_REGEX.test(ref)).toBe(false)
        const parseResult = uploadOptionsSchema.safeParse({
          customerReference: ref,
        })
        expect(parseResult.success).toBe(false)
      }
    })

    it('allows uploadOptions without customerReference (optional)', () => {
      const parseResult = uploadOptionsSchema.safeParse({})
      expect(parseResult.success).toBe(true)
      if (parseResult.success) {
        expect(parseResult.data.customerReference).toBeUndefined()
      }
    })
  })

  describe('Folder child inheritance of customerReference', () => {
    it('inherits customerReference from parent folder when child options omit it', async () => {
      const user = createMockUser()
      const folderId = 'folder-upload-123'
      const parentOptions = { customerReference: 'client-project-42' }

      const parentUpload = {
        id: folderId,
        type: UploadType.FOLDER,
        status: UploadStatus.PENDING,
        name: 'test-folder',
        file_tree: null,
        mime_type: null,
        root_upload_id: folderId,
        relative_id: null,
        oauth_provider: user.oauthProvider,
        oauth_user_id: user.oauthUserId,
        upload_options: parentOptions,
        updated_at: new Date(),
      }

      jest
        .spyOn(uploadsRepository, 'getUploadEntryById')
        .mockResolvedValue(parentUpload)

      const createUploadEntrySpy = jest
        .spyOn(uploadsRepository, 'createUploadEntry')
        .mockResolvedValue({
          id: 'child-file-456',
          type: UploadType.FILE,
          status: UploadStatus.PENDING,
          name: 'child.txt',
          file_tree: null,
          mime_type: 'text/plain',
          root_upload_id: folderId,
          relative_id: 'rel-1',
          oauth_provider: user.oauthProvider,
          oauth_user_id: user.oauthUserId,
          upload_options: parentOptions,
          updated_at: new Date(),
        })

      await UploadsUseCases.createFileInFolder(
        user,
        folderId,
        'rel-1',
        'child.txt',
        'text/plain',
        null,
      )

      expect(createUploadEntrySpy).toHaveBeenCalledTimes(1)
      const passedOptions = createUploadEntrySpy.mock.calls[0][10]
      expect(passedOptions?.customerReference).toBe('client-project-42')
    })

    it('preserves child customerReference if explicitly specified', async () => {
      const user = createMockUser()
      const folderId = 'folder-upload-123'

      const parentUpload = {
        id: folderId,
        type: UploadType.FOLDER,
        status: UploadStatus.PENDING,
        name: 'test-folder',
        file_tree: null,
        mime_type: null,
        root_upload_id: folderId,
        relative_id: null,
        oauth_provider: user.oauthProvider,
        oauth_user_id: user.oauthUserId,
        upload_options: { customerReference: 'parent-ref' },
        updated_at: new Date(),
      }

      jest
        .spyOn(uploadsRepository, 'getUploadEntryById')
        .mockResolvedValue(parentUpload)

      const createUploadEntrySpy = jest
        .spyOn(uploadsRepository, 'createUploadEntry')
        .mockResolvedValue({
          id: 'child-file-456',
          type: UploadType.FILE,
          status: UploadStatus.PENDING,
          name: 'child.txt',
          file_tree: null,
          mime_type: 'text/plain',
          root_upload_id: folderId,
          relative_id: 'rel-1',
          oauth_provider: user.oauthProvider,
          oauth_user_id: user.oauthUserId,
          upload_options: { customerReference: 'child-override-ref' },
          updated_at: new Date(),
        })

      await UploadsUseCases.createFileInFolder(
        user,
        folderId,
        'rel-1',
        'child.txt',
        'text/plain',
        { customerReference: 'child-override-ref' },
      )

      expect(createUploadEntrySpy).toHaveBeenCalledTimes(1)
      const passedOptions = createUploadEntrySpy.mock.calls[0][10]
      expect(passedOptions?.customerReference).toBe('child-override-ref')
    })
  })

  describe('Interactions Repository customer_reference persistence', () => {
    it('passes customerReference as 8th parameter to INSERT query', async () => {
      const queryMock = jest.fn<() => Promise<unknown>>().mockResolvedValue({
        rows: [
          {
            id: 'interaction-1',
            account_id: 'account-1',
            type: 'upload',
            size: '1024',
            source: 'free_tier',
            cid: 'bafytest',
            api_key_id: 'key-123',
            customer_reference: 'my-partner-ref:001',
            created_at: new Date().toISOString(),
          },
        ],
      })

      const mockDb = { query: queryMock } as unknown as Parameters<
        typeof interactionsRepository.createInteraction
      >[8]

      const interaction = await interactionsRepository.createInteraction(
        'interaction-1',
        'account-1',
        'upload' as unknown as Parameters<
          typeof interactionsRepository.createInteraction
        >[2],
        BigInt(1024),
        'free_tier' as unknown as Parameters<
          typeof interactionsRepository.createInteraction
        >[4],
        'bafytest',
        'key-123',
        'my-partner-ref:001',
        mockDb,
      )

      expect(queryMock).toHaveBeenCalledTimes(1)
      const [sql, params] = queryMock.mock.calls[0] as unknown as [
        string,
        unknown[],
      ]
      expect(sql).toContain('customer_reference')
      expect(params).toHaveLength(8)
      expect(params[7]).toBe('my-partner-ref:001')
      expect(interaction.customerReference).toBe('my-partner-ref:001')
    })

    it('passes null when customerReference is omitted', async () => {
      const queryMock = jest.fn<() => Promise<unknown>>().mockResolvedValue({
        rows: [
          {
            id: 'interaction-2',
            account_id: 'account-1',
            type: 'upload',
            size: '1024',
            source: 'free_tier',
            cid: 'bafytest',
            api_key_id: null,
            customer_reference: null,
            created_at: new Date().toISOString(),
          },
        ],
      })

      const mockDb = { query: queryMock } as unknown as Parameters<
        typeof interactionsRepository.createInteraction
      >[8]

      const interaction = await interactionsRepository.createInteraction(
        'interaction-2',
        'account-1',
        'upload' as unknown as Parameters<
          typeof interactionsRepository.createInteraction
        >[2],
        BigInt(1024),
        'free_tier' as unknown as Parameters<
          typeof interactionsRepository.createInteraction
        >[4],
        'bafytest',
        undefined,
        undefined,
        mockDb,
      )

      expect(queryMock).toHaveBeenCalledTimes(1)
      const [, params] = queryMock.mock.calls[0] as unknown as [
        string,
        unknown[],
      ]
      expect(params[7]).toBeNull()
      expect(interaction.customerReference).toBeNull()
    })
  })

  describe('S3-compatible API x-amz-meta-customer-reference', () => {
    const VALID_AUTH =
      'AWS4-HMAC-SHA256 Credential=e046e71c8dc3459c8da189e62418203a/20260821/us-west-2/s3/aws4_request, SignedHeaders=host, Signature=0'

    const stubRes = () => {
      const headers = new Map<string, string>()
      const state: { status: number; body: string } = { status: 200, body: '' }
      const res = {
        set: (name: string, value: string) => {
          headers.set(name.toLowerCase(), value)
          return res
        },
        setHeader: (name: string, value: string) => {
          headers.set(name.toLowerCase(), value)
          return res
        },
        status: (code: number) => {
          state.status = code
          return res
        },
        send: (body: string) => {
          state.body = body
          return res
        },
        end: () => res,
      }
      return { res: res as unknown as Response, headers, state }
    }

    const mockAuth = () =>
      jest
        .spyOn(AuthManager, 'getUserFromAccessToken')
        .mockResolvedValue(createMockUser() as never)

    it('rejects PutObject with invalid customer reference with 400 InvalidArgument XML', async () => {
      mockAuth()
      const { res, state } = stubRes()
      const req = {
        headers: {
          authorization: VALID_AUTH,
          'x-amz-meta-customer-reference': 'invalid ref with spaces',
        },
        params: { key: 'test-bucket/test-file.bin' },
        body: Buffer.from('hello world'),
        query: {},
      } as unknown as Request

      await putObjectHandler(req, res)

      expect(state.status).toBe(400)
      expect(state.body).toContain('<Code>InvalidArgument</Code>')
      expect(state.body).toContain('Invalid customer reference')
    })

    it('forwards valid x-amz-meta-customer-reference to S3UseCases.putObject', async () => {
      mockAuth()
      const { res, state } = stubRes()
      const putSpy = jest.spyOn(S3UseCases, 'putObject').mockResolvedValue(
        ok({
          ETag: '"etag-123"',
          Cid: 'bafytest',
        }) as never,
      )

      const req = {
        headers: {
          authorization: VALID_AUTH,
          'x-amz-meta-customer-reference': 'tenant:client_001.test',
        },
        params: { key: 'test-bucket/test-file.bin' },
        body: Buffer.from('hello world'),
        query: {},
      } as unknown as Request

      await putObjectHandler(req, res)

      expect(state.status).toBe(200)
      expect(putSpy).toHaveBeenCalledTimes(1)
      const callArgs = putSpy.mock.calls[0][1] as {
        UploadOptions?: { customerReference?: string }
      }
      expect(callArgs.UploadOptions?.customerReference).toBe(
        'tenant:client_001.test',
      )
    })

    it('rejects CreateMultipartUpload with invalid customer reference with 400 InvalidArgument XML', async () => {
      mockAuth()
      const { res, state } = stubRes()
      const req = {
        headers: {
          authorization: VALID_AUTH,
          'x-amz-meta-customer-reference': 'bad!char',
        },
        params: { key: 'test-bucket/large-file.bin' },
        query: {},
      } as unknown as Request

      await createMultipartUploadHandler(req, res)

      expect(state.status).toBe(400)
      expect(state.body).toContain('<Code>InvalidArgument</Code>')
      expect(state.body).toContain('Invalid customer reference')
    })

    it('forwards valid x-amz-meta-customer-reference to S3UseCases.createMultipartUpload', async () => {
      mockAuth()
      const { res } = stubRes()
      const multipartSpy = jest
        .spyOn(S3UseCases, 'createMultipartUpload')
        .mockResolvedValue(
          ok({
            UploadId: 'mp-upload-123',
            Bucket: 'test-bucket',
            Key: 'large-file.bin',
          }) as never,
        )

      const req = {
        headers: {
          authorization: VALID_AUTH,
          'x-amz-meta-customer-reference': 'valid-mp-ref-42',
        },
        params: { key: 'test-bucket/large-file.bin' },
        query: {},
      } as unknown as Request

      await createMultipartUploadHandler(req, res)

      expect(multipartSpy).toHaveBeenCalledTimes(1)
      const callArgs = multipartSpy.mock.calls[0][1] as {
        UploadOptions?: { customerReference?: string }
      }
      expect(callArgs.UploadOptions?.customerReference).toBe('valid-mp-ref-42')
    })
  })
})

