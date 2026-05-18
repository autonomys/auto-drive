import { dbMigration } from '../../utils/dbMigrate.js'
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { jest } from '@jest/globals'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { config } from '../../../src/config.js'
import { AccountsUseCases } from '../../../src/core/index.js'

describe('AWS S3 - SDK', () => {
  let s3Client: S3Client
  const user = createMockUser()
  const BASE_PATH = `http://localhost:${config.express.port}`
  const Bucket = `${BASE_PATH}/s3`

  beforeAll(async () => {
    await dbMigration.up()

    // Mock warnings to clean test logs
    const consoleWarn = global.console.warn
    global.console.warn = () => {}
    // Start the frontend server
    await import('../../../src/app/apis/download.js')
    global.console.warn = consoleWarn
    // Wait for the server to start
    await new Promise((resolve) => setTimeout(resolve, 500))

    mockRabbitPublish()
    // onboard the user
    await AccountsUseCases.getOrCreateAccount(user)

    // mock auth manager returning the mock user
    jest.spyOn(AuthManager, 'getUserFromAccessToken').mockResolvedValue(user)
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(user)

    s3Client = new S3Client({
      region: 'us-east-1',
      // endpoint is required so that operations with no Bucket param (e.g.
      // ListBuckets) have a base URL to target; bucketEndpoint:true then
      // overrides the endpoint with the Bucket value for per-object operations.
      endpoint: `${BASE_PATH}/s3`,
      credentials: {
        accessKeyId: 'e046e71c8dc3459c8da189e62418203a',
        secretAccessKey: '',
      },
      bucketEndpoint: true,
    })
  })

  afterAll(async () => {
    unmockMethods()
    await dbMigration.down()
  })

  it('should be healthy the server', async () => {
    const response = await fetch(
      `http://localhost:${config.express.port}/health`,
    )
    expect(response.status).toBe(204)
  })

  const Key = 'test.txt'
  const Body = Buffer.from('Hello, world!')

  it('should upload an object', async () => {
    const command = new PutObjectCommand({
      Bucket,
      Key: 'test.txt',
      Body,
    })
    const result = await s3Client.send(command)
    // ETag must be a quoted MD5 hex digest (standard S3 format)
    expect(result.ETag).toMatch(/^"[a-f0-9]{32}"$/)
  })

  it('should download the object', async () => {
    const command = new GetObjectCommand({
      Bucket,
      Key,
    })

    const result = await s3Client.send(command)

    expect(result.Body).toBeDefined()
    expect(Buffer.from(await result.Body!.transformToByteArray())).toEqual(Body)
  }, 15_000)

  it('should be able download first 10 bytes of the object', async () => {
    const command = new GetObjectCommand({
      Bucket,
      Key,
      Range: 'bytes 0-9',
    })

    const result = await s3Client.send(command)

    expect(result.Body).toBeDefined()
    expect(result.ContentRange).toBe('bytes 0-9/13')
    const body = await result.Body!.transformToByteArray()
    expect(body.length).toBe(10)
    expect(body).toMatchObject(Body.subarray(0, 10).buffer)
  })

  const SecondKey = 'test2.txt'
  const SecondBody = Buffer.from('Hello, world!')

  it('should be able to upload an object with multipart upload', async () => {
    const createCommand = new CreateMultipartUploadCommand({
      Bucket,
      Key: SecondKey,
    })

    const result = await s3Client.send(createCommand)
    expect(result).toMatchObject({
      UploadId: expect.any(String),
    })

    const uploadId = result.UploadId!

    const uploadPartCommand = new UploadPartCommand({
      Bucket,
      Key: SecondKey,
      UploadId: uploadId,
      PartNumber: 1,
      Body: SecondBody,
    })

    const partUploadResult = await s3Client.send(uploadPartCommand)
    // Part ETag must be a quoted MD5
    expect(partUploadResult.ETag).toMatch(/^"[a-f0-9]{32}"$/)

    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket,
      Key: SecondKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: [
          {
            ETag: partUploadResult.ETag!,
            PartNumber: 1,
          },
        ],
      },
    })

    const completeResult = await s3Client.send(completeCommand)
    // Single-part multipart ETag: "<md5>-1"
    expect(completeResult.ETag).toMatch(/^"[a-f0-9]{32}-1"$/)
  })

  it('should be able to download the object', async () => {
    const command = new GetObjectCommand({
      Bucket,
      Key: SecondKey,
    })

    const result = await s3Client.send(command)

    expect(result.Body).toBeDefined()
    expect(Buffer.from(await result.Body!.transformToByteArray())).toEqual(
      SecondBody,
    )
  })

  // Bucket-prefixed key: first segment becomes the bucket name
  describe('Bucket-prefixed keys', () => {
    const BucketedKey = 'my-archive/report.txt'
    const BucketedBody = Buffer.from('Archived content')

    it('should upload an object with a bucket-prefixed key', async () => {
      const command = new PutObjectCommand({
        Bucket,
        Key: BucketedKey,
        Body: BucketedBody,
      })
      const result = await s3Client.send(command)
      expect(result).toMatchObject({ ETag: expect.any(String) })
    })

    it('should download a bucket-prefixed object', async () => {
      const command = new GetObjectCommand({ Bucket, Key: BucketedKey })
      const result = await s3Client.send(command)
      expect(result.Body).toBeDefined()
      expect(Buffer.from(await result.Body!.transformToByteArray())).toEqual(
        BucketedBody,
      )
    }, 15_000)

    it('should upload objects into a second bucket', async () => {
      const command = new PutObjectCommand({
        Bucket,
        Key: 'another-bucket/file.txt',
        Body: Buffer.from('Another bucket'),
      })
      const result = await s3Client.send(command)
      expect(result).toMatchObject({ ETag: expect.any(String) })
    })
  })

  describe('ListBuckets', () => {
    it('should list all buckets', async () => {
      const command = new ListBucketsCommand({})
      const result = await s3Client.send(command)

      expect(result.Buckets).toBeDefined()
      expect(result.Buckets!.length).toBeGreaterThan(0)

      const bucketNames = result.Buckets!.map((b) => b.Name)
      // Flat keys land in 'default'; bucket-prefixed keys create named buckets
      expect(bucketNames).toContain('default')
      expect(bucketNames).toContain('my-archive')
      expect(bucketNames).toContain('another-bucket')
    })

    it('each bucket should have a creation date', async () => {
      const command = new ListBucketsCommand({})
      const result = await s3Client.send(command)
      for (const bucket of result.Buckets!) {
        expect(bucket.CreationDate).toBeInstanceOf(Date)
      }
    })
  })

  describe('DeleteObject', () => {
    it('should return 403 AccessDenied - storage is immutable', async () => {
      const command = new DeleteObjectCommand({ Bucket, Key: 'test.txt' })
      await expect(s3Client.send(command)).rejects.toMatchObject({
        $metadata: { httpStatusCode: 403 },
        Code: 'AccessDenied',
      })
    })
  })

  describe('Metadata handled correctly', () => {
    const ThirdKey = 'test3.txt'

    it('should be able to upload an object with compression and encryption', async () => {
      const command = new PutObjectCommand({
        Bucket,
        Key: ThirdKey,
        Body,
        Metadata: {
          compression: 'ZLIB',
          encryption: 'AES_256_GCM',
        },
      })

      const result = await s3Client.send(command)
      expect(result.ETag).toMatch(/^"[a-f0-9]{32}"$/)
    })

    it('should return MD5 ETag and CID header on HeadObject', async () => {
      const command = new HeadObjectCommand({
        Bucket,
        Key: ThirdKey,
      })

      const result = await s3Client.send(command)

      expect(result.Metadata?.compression).toBe('ZLIB')
      expect(result.Metadata?.encryption).toBe('AES_256_GCM')
      // ETag must be a quoted MD5, not a CID
      expect(result.ETag).toMatch(/^"[a-f0-9]{32}"$/)
      // CID must be present in the custom header
      expect(result.Metadata?.cid).toBeDefined()
    })
  })
})
