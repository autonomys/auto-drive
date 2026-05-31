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

  // Regression for #725: S3 multipart explicitly allows parts to arrive in any
  // order (parallel uploads, retries, etc.) — PartNumber identifies position,
  // not arrival order.  Pre-fix, the processing layer rejected non-sequential
  // arrivals and the assembled object only contained whichever contiguous
  // prefix of parts happened to arrive in order.
  describe('Out-of-order multipart upload', () => {
    const OutOfOrderKey = 'multipart-out-of-order.bin'
    const PART_SIZE = 16 * 1024
    // Distinct, deterministic per-part content so misordered assembly is
    // detectable byte-for-byte.
    const PartA = Buffer.alloc(PART_SIZE, 'A')
    const PartB = Buffer.alloc(PART_SIZE, 'B')
    const PartC = Buffer.alloc(PART_SIZE, 'C')
    const ExpectedBody = Buffer.concat([PartA, PartB, PartC])

    it('uploaded as [2,1,3] and completed as [3,1,2] should assemble to A‖B‖C', async () => {
      const create = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: OutOfOrderKey }),
      )
      const uploadId = create.UploadId!

      // Upload parts in non-monotonic arrival order: 2, then 1, then 3.
      const upPart = (partNumber: number, body: Buffer) =>
        s3Client.send(
          new UploadPartCommand({
            Bucket,
            Key: OutOfOrderKey,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: body,
          }),
        )
      const e2 = await upPart(2, PartB)
      const e1 = await upPart(1, PartA)
      const e3 = await upPart(3, PartC)

      expect(e1.ETag).toMatch(MD5_ETAG_RE)
      expect(e2.ETag).toMatch(MD5_ETAG_RE)
      expect(e3.ETag).toMatch(MD5_ETAG_RE)

      // Complete with parts listed in yet another order (3, 1, 2).  The
      // server must sort by PartNumber regardless of either arrival order
      // or completion-list order.
      const complete = await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: OutOfOrderKey,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [
              { ETag: e3.ETag!, PartNumber: 3 },
              { ETag: e1.ETag!, PartNumber: 1 },
              { ETag: e2.ETag!, PartNumber: 2 },
            ],
          },
        }),
      )
      expect(complete.ETag).toMatch(MULTIPART_ETAG_RE)

      // Download and verify the assembled body is A‖B‖C in PartNumber
      // order, not arrival or completion-list order.
      const downloaded = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: OutOfOrderKey }),
      )
      const body = Buffer.from(
        await downloaded.Body!.transformToByteArray(),
      )
      expect(body.length).toBe(ExpectedBody.length)
      expect(body).toEqual(ExpectedBody)
    }, 30_000)

    // Regression for the Bugbot finding on #726: uploading PartNumbers 1 and 3
    // with no part 2 must NOT successfully finalise.  Pre-fix the assembled
    // metadata would report bytes for part 3 even though those bytes never
    // entered the IPLD tree (the drain stopped at the gap and the size sum
    // included part 3 regardless).
    it('completion should refuse when there is a gap in the parts sequence', async () => {
      const KeyGap = 'multipart-with-gap.bin'
      const create = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: KeyGap }),
      )
      const uploadId = create.UploadId!

      const e1 = await s3Client.send(
        new UploadPartCommand({
          Bucket,
          Key: KeyGap,
          UploadId: uploadId,
          PartNumber: 1,
          Body: PartA,
        }),
      )
      // Skip PartNumber 2; upload PartNumber 3 directly.
      const e3 = await s3Client.send(
        new UploadPartCommand({
          Bucket,
          Key: KeyGap,
          UploadId: uploadId,
          PartNumber: 3,
          Body: PartC,
        }),
      )

      // Both per-part requests succeed (parts are stored).  Completion is
      // where the gap surfaces.
      await expect(
        s3Client.send(
          new CompleteMultipartUploadCommand({
            Bucket,
            Key: KeyGap,
            UploadId: uploadId,
            MultipartUpload: {
              Parts: [
                { ETag: e1.ETag!, PartNumber: 1 },
                { ETag: e3.ETag!, PartNumber: 3 },
              ],
            },
          }),
        ),
      ).rejects.toMatchObject({
        $metadata: { httpStatusCode: 400 },
      })
    }, 30_000)

    // Regression for the Bugbot finding on #726: pre-fix, addChunk used a
    // bare INSERT which 500'd on the (upload_id, part_index) primary key when
    // a client retried the same PartNumber (e.g. after a network failure
    // mid-response).  S3 explicitly allows part retries.  Verify that
    // re-uploading the same PartNumber succeeds and the final assembled body
    // reflects the retried bytes.
    it('should accept a part retry with the same PartNumber', async () => {
      const KeyRetry = 'multipart-retry.bin'
      const create = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: KeyRetry }),
      )
      const uploadId = create.UploadId!

      const upload = (body: Buffer) =>
        s3Client.send(
          new UploadPartCommand({
            Bucket,
            Key: KeyRetry,
            UploadId: uploadId,
            PartNumber: 1,
            Body: body,
          }),
        )

      // First attempt with PartA.
      const firstAttempt = await upload(PartA)
      expect(firstAttempt.ETag).toMatch(MD5_ETAG_RE)

      // Retry the same PartNumber.  Pre-fix this 500'd on the PK violation;
      // post-fix the UPSERT replaces the stored bytes.
      const retry = await upload(PartA)
      expect(retry.ETag).toMatch(MD5_ETAG_RE)
      expect(retry.ETag).toBe(firstAttempt.ETag)

      const complete = await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: KeyRetry,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [{ ETag: retry.ETag!, PartNumber: 1 }],
          },
        }),
      )
      expect(complete.ETag).toMatch(MULTIPART_ETAG_RE)

      const downloaded = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: KeyRetry }),
      )
      const body = Buffer.from(
        await downloaded.Body!.transformToByteArray(),
      )
      expect(body).toEqual(PartA)
    }, 30_000)

    // A retry that changes the bytes of an *already-processed* part cannot be
    // honoured by the streaming model — the part is already baked into the
    // IPLD tree.  Silently accepting it would leave the assembled CID (old
    // bytes) inconsistent with the size and composite ETag (new bytes).
    // Reject it with a 400 rather than corrupt.  (An identical retry, covered
    // above, is a harmless no-op.)
    it('should reject a divergent retry of an already-processed part', async () => {
      const KeyDiverge = 'multipart-divergent-retry.bin'
      const create = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: KeyDiverge }),
      )
      const uploadId = create.UploadId!

      // PartNumber 1 arrives in order and is processed immediately.
      const first = await s3Client.send(
        new UploadPartCommand({
          Bucket,
          Key: KeyDiverge,
          UploadId: uploadId,
          PartNumber: 1,
          Body: PartA,
        }),
      )
      expect(first.ETag).toMatch(MD5_ETAG_RE)

      // Re-upload PartNumber 1 with *different* bytes — must be rejected.
      await expect(
        s3Client.send(
          new UploadPartCommand({
            Bucket,
            Key: KeyDiverge,
            UploadId: uploadId,
            PartNumber: 1,
            Body: PartB,
          }),
        ),
      ).rejects.toMatchObject({
        $metadata: { httpStatusCode: 400 },
      })
    }, 30_000)

    // Regression for the Bugbot finding on #726: concurrent UploadPart calls
    // for the same upload_id used to race on last_processed_part_index — two
    // drains could both grab the same `next` index and call processChunk
    // twice, silently double-counting bytes into the IPLD tree.  Stress the
    // lock by firing all three uploadParts in parallel and asserting the
    // assembled body is exactly A‖B‖C.  The test is non-deterministic by
    // nature (Promise.all is unlikely to truly synchronise on the I/O
    // boundary), but a regression that removed the lock would fail this
    // stochastically over enough runs.
    it('concurrent uploadParts should still assemble correctly', async () => {
      const KeyConc = 'multipart-concurrent.bin'
      const create = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: KeyConc }),
      )
      const uploadId = create.UploadId!

      const upPart = (partNumber: number, body: Buffer) =>
        s3Client.send(
          new UploadPartCommand({
            Bucket,
            Key: KeyConc,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: body,
          }),
        )

      // Fire all three in parallel.
      const [e1, e2, e3] = await Promise.all([
        upPart(1, PartA),
        upPart(2, PartB),
        upPart(3, PartC),
      ])
      expect(e1.ETag).toMatch(MD5_ETAG_RE)
      expect(e2.ETag).toMatch(MD5_ETAG_RE)
      expect(e3.ETag).toMatch(MD5_ETAG_RE)

      const complete = await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: KeyConc,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [
              { ETag: e1.ETag!, PartNumber: 1 },
              { ETag: e2.ETag!, PartNumber: 2 },
              { ETag: e3.ETag!, PartNumber: 3 },
            ],
          },
        }),
      )
      expect(complete.ETag).toMatch(MULTIPART_ETAG_RE)

      const downloaded = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: KeyConc }),
      )
      const body = Buffer.from(
        await downloaded.Body!.transformToByteArray(),
      )
      expect(body.length).toBe(ExpectedBody.length)
      expect(body).toEqual(ExpectedBody)
    }, 30_000)
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

    it('should return the MD5 ETag (not the CID), matching HeadObject', async () => {
      // Regression: the listing previously returned the CID as the ETag, so
      // checksum-verifying clients (rclone, AWS CLI) could not validate against
      // a listing. Every listed ETag must be a quoted 32-hex MD5 (a CID would
      // not match), and must equal the ETag HeadObject returns for that object.
      const list = await s3Client.send(
        new ListObjectsV2Command({ Bucket: ListBucket }),
      )
      const entry = list.Contents!.find((c) => c.Key === 'a.txt')
      expect(entry).toBeDefined()
      expect(entry!.ETag).toMatch(MD5_ETAG_RE)

      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket, Key: 'list-test/a.txt' }),
      )
      expect(entry!.ETag).toBe(head.ETag)
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

  // Raw HTTP requests that mimic the AWS CLI / botocore, which (unlike the JS
  // SDK used above) does NOT send the `x-id` query param for GetObject/
  // PutObject and sends object bodies with no Content-Type header. These guard
  // two regressions:
  //   1. getS3Method must fall back to the HTTP method (GET->GetObject,
  //      PUT->PutObject) when `x-id` is absent — otherwise dispatch returns
  //      "Method not found".
  //   2. The request body must be read as raw bytes regardless of Content-Type;
  //      a missing Content-Type previously left req.body as {} and broke
  //      uploads deep in the IPLD chunker.
  describe('Raw HTTP requests (AWS CLI style: no x-id, no Content-Type)', () => {
    const S3_BASE = `${BASE_PATH}/s3`
    // handleS3Auth only needs an Authorization header containing
    // `Credential=<alphanumeric>/`; AuthManager is mocked to return `user`.
    const AUTH =
      'AWS4-HMAC-SHA256 Credential=clitestkey/20200101/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=deadbeef'

    // Passing a Uint8Array/Buffer body to fetch leaves Content-Type unset,
    // reproducing the AWS CLI's behaviour. No `x-id` query param is added.
    const rawS3 = (method: string, path: string, body?: Uint8Array) =>
      fetch(`${S3_BASE}${path}`, {
        method,
        headers: { Authorization: AUTH },
        // Cast: TS 5.7 types Buffer/Uint8Array as Uint8Array<ArrayBufferLike>,
        // which doesn't structurally match the DOM BodyInit union. A binary
        // body still sends with no Content-Type, which is the point here.
        body: body as unknown as BodyInit | undefined,
      })

    const CliBody = Buffer.from('hello from the aws cli')

    it('PutObject without x-id/Content-Type stores the object', async () => {
      const res = await rawS3('PUT', '/cli-test/hello.txt', CliBody)
      expect(res.status).toBe(200)
      expect(res.headers.get('etag')).toMatch(MD5_ETAG_RE)
    }, 15_000)

    it('GetObject without x-id returns the exact bytes', async () => {
      const res = await rawS3('GET', '/cli-test/hello.txt')
      expect(res.status).toBe(200)
      const got = Buffer.from(await res.arrayBuffer())
      expect(got).toEqual(CliBody)
    }, 15_000)

    it('multipart upload via raw requests round-trips (the original 500)', async () => {
      const key = '/cli-test/mpu.bin'
      const part1 = Buffer.from('AAAAAAAAAAAAAAAA')
      const part2 = Buffer.from('BBBBBBBBBBBBBBBB')

      const create = await rawS3('POST', `${key}?uploads`)
      expect(create.status).toBe(200)
      const uploadId = (await create.text()).match(
        /<UploadId>([^<]+)<\/UploadId>/,
      )?.[1]
      expect(uploadId).toBeDefined()

      // Parts must be uploaded sequentially (the chunker enforces ordering).
      const up1 = await rawS3(
        'PUT',
        `${key}?partNumber=1&uploadId=${uploadId}`,
        part1,
      )
      expect(up1.status).toBe(200)
      const etag1 = up1.headers.get('etag')!
      expect(etag1).toMatch(MD5_ETAG_RE)

      const up2 = await rawS3(
        'PUT',
        `${key}?partNumber=2&uploadId=${uploadId}`,
        part2,
      )
      expect(up2.status).toBe(200)
      const etag2 = up2.headers.get('etag')!

      // The part list in the body is used only to compute the composite ETag.
      const completeBody = Buffer.from(
        '<CompleteMultipartUpload>' +
          `<Part><ETag>${etag1}</ETag><PartNumber>1</PartNumber></Part>` +
          `<Part><ETag>${etag2}</ETag><PartNumber>2</PartNumber></Part>` +
          '</CompleteMultipartUpload>',
      )
      const complete = await rawS3(
        'POST',
        `${key}?uploadId=${uploadId}`,
        completeBody,
      )
      expect(complete.status).toBe(200)
      expect(complete.headers.get('etag')).toMatch(MULTIPART_ETAG_RE)

      const get = await rawS3('GET', key)
      expect(get.status).toBe(200)
      const got = Buffer.from(await get.arrayBuffer())
      expect(got).toEqual(Buffer.concat([part1, part2]))
    }, 30_000)
  })
})
