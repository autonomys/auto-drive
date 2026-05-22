import { dbMigration } from '../../utils/dbMigrate.js'
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
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

/** Quoted single-object MD5 ETag: `"<32 hex chars>"` */
const MD5_ETAG_RE = /^"[a-f0-9]{32}"$/
/** Composite multipart ETag: `"<32 hex chars>-<N>"` */
const MULTIPART_ETAG_RE = /^"[a-f0-9]{32}-\d+"$/

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
    expect(result.ETag).toMatch(MD5_ETAG_RE)
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
    expect(partUploadResult.ETag).toMatch(MD5_ETAG_RE)

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
    expect(completeResult.ETag).toMatch(MULTIPART_ETAG_RE)
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

  describe('ListObjectsV2', () => {
    // With bucketEndpoint:true, use the full URL as Bucket so the SDK sends
    // GET /list-test/?list-type=2 to our router.
    const ListBucket = `${BASE_PATH}/s3/list-test`

    beforeAll(async () => {
      // Populate the 'list-test' bucket with a mix of flat and nested keys.
      const uploads = [
        { Key: 'list-test/a.txt', Body: Buffer.from('aaa') },
        { Key: 'list-test/b.txt', Body: Buffer.from('bbb') },
        { Key: 'list-test/subdir/c.txt', Body: Buffer.from('ccc') },
        { Key: 'list-test/subdir/d.txt', Body: Buffer.from('ddd') },
        { Key: 'list-test/other/e.txt', Body: Buffer.from('eee') },
      ]
      for (const u of uploads) {
        await s3Client.send(new PutObjectCommand({ Bucket, ...u }))
      }
    })

    it('should list all objects in a bucket', async () => {
      const result = await s3Client.send(
        new ListObjectsV2Command({ Bucket: ListBucket }),
      )
      expect(result.KeyCount).toBe(5)
      expect(result.IsTruncated).toBe(false)
      const keys = result.Contents!.map((c) => c.Key)
      expect(keys).toContain('a.txt')
      expect(keys).toContain('b.txt')
      expect(keys).toContain('subdir/c.txt')
      expect(keys).toContain('subdir/d.txt')
      expect(keys).toContain('other/e.txt')
    })

    it('should include Size and LastModified for each object', async () => {
      const result = await s3Client.send(
        new ListObjectsV2Command({ Bucket: ListBucket }),
      )
      for (const obj of result.Contents!) {
        expect(typeof obj.Size).toBe('number')
        expect(obj.LastModified).toBeInstanceOf(Date)
      }
    })

    it('should filter by prefix', async () => {
      const result = await s3Client.send(
        new ListObjectsV2Command({ Bucket: ListBucket, Prefix: 'subdir/' }),
      )
      expect(result.KeyCount).toBe(2)
      const keys = result.Contents!.map((c) => c.Key)
      expect(keys).toEqual(['subdir/c.txt', 'subdir/d.txt'])
    })

    it('should fold keys at delimiter into CommonPrefixes', async () => {
      const result = await s3Client.send(
        new ListObjectsV2Command({ Bucket: ListBucket, Delimiter: '/' }),
      )
      // 2 flat objects + 2 virtual subdirectories = 4 entries
      expect(result.KeyCount).toBe(4)
      expect(result.IsTruncated).toBe(false)

      const keys = result.Contents!.map((c) => c.Key)
      expect(keys).toEqual(['a.txt', 'b.txt'])

      const prefixes = result.CommonPrefixes!.map((p) => p.Prefix)
      expect(prefixes).toEqual(['other/', 'subdir/'])
    })

    it('should list a virtual subdirectory with prefix + delimiter', async () => {
      const result = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: ListBucket,
          Prefix: 'subdir/',
          Delimiter: '/',
        }),
      )
      expect(result.KeyCount).toBe(2)
      const keys = result.Contents!.map((c) => c.Key)
      expect(keys).toEqual(['subdir/c.txt', 'subdir/d.txt'])
      expect(result.CommonPrefixes ?? []).toHaveLength(0)
    })

    it('should paginate with MaxKeys', async () => {
      // First page: 2 entries
      const page1 = await s3Client.send(
        new ListObjectsV2Command({ Bucket: ListBucket, MaxKeys: 2 }),
      )
      expect(page1.KeyCount).toBe(2)
      expect(page1.IsTruncated).toBe(true)
      expect(page1.NextContinuationToken).toBeDefined()

      // Second page: next 2 entries
      const page2 = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: ListBucket,
          MaxKeys: 2,
          ContinuationToken: page1.NextContinuationToken,
        }),
      )
      expect(page2.KeyCount).toBe(2)
      expect(page2.IsTruncated).toBe(true)

      // Third page: last 1 entry
      const page3 = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: ListBucket,
          MaxKeys: 2,
          ContinuationToken: page2.NextContinuationToken,
        }),
      )
      expect(page3.KeyCount).toBe(1)
      expect(page3.IsTruncated).toBe(false)

      // All pages together account for all 5 objects with no duplicates
      const allKeys = [
        ...(page1.Contents ?? []),
        ...(page2.Contents ?? []),
        ...(page3.Contents ?? []),
      ].map((c) => c.Key)
      expect(new Set(allKeys).size).toBe(5)
    })

    it('should return empty result for prefix with no matches', async () => {
      const result = await s3Client.send(
        new ListObjectsV2Command({ Bucket: ListBucket, Prefix: 'nonexistent/' }),
      )
      expect(result.KeyCount).toBe(0)
      expect(result.Contents ?? []).toHaveLength(0)
      expect(result.IsTruncated).toBe(false)
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
      expect(result.ETag).toMatch(MD5_ETAG_RE)
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
      expect(result.ETag).toMatch(MD5_ETAG_RE)
      // CID must be present in the custom header
      expect(result.Metadata?.cid).toBeDefined()
    })
  })
})
