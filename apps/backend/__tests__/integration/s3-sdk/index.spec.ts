import { gzipSync } from 'zlib'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
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

  // S3 allows parts to arrive in any order; PartNumber identifies position,
  // not arrival order.
  describe('Out-of-order multipart upload', () => {
    const OutOfOrderKey = 'multipart-out-of-order.bin'
    const PART_SIZE = 16 * 1024
    // Distinct content per part so misordered assembly is detectable.
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

    // A gap (parts 1 and 3, no 2) must not finalise: part 3's bytes are
    // counted in the size but never reach the IPLD tree.
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

    // S3 allows re-uploading a PartNumber; an identical retry must succeed.
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

      const firstAttempt = await upload(PartA)
      expect(firstAttempt.ETag).toMatch(MD5_ETAG_RE)

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

    // A processed part is already in the IPLD tree and cannot be replaced, so a
    // retry with different bytes is rejected rather than left inconsistent.
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

    // Concurrent uploads of the same part_index must converge to a single
    // processed chunk. Identical bytes keep the assertion deterministic.
    it('concurrent identical uploads of the same part should not corrupt', async () => {
      const KeySameIdx = 'multipart-same-index-concurrent.bin'
      const create = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: KeySameIdx }),
      )
      const uploadId = create.UploadId!

      const upPart1 = () =>
        s3Client.send(
          new UploadPartCommand({
            Bucket,
            Key: KeySameIdx,
            UploadId: uploadId,
            PartNumber: 1,
            Body: PartA,
          }),
        )

      const [r1, r2] = await Promise.all([upPart1(), upPart1()])
      expect(r1.ETag).toMatch(MD5_ETAG_RE)
      expect(r2.ETag).toMatch(MD5_ETAG_RE)
      expect(r1.ETag).toBe(r2.ETag)

      const complete = await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: KeySameIdx,
          UploadId: uploadId,
          MultipartUpload: { Parts: [{ ETag: r1.ETag!, PartNumber: 1 }] },
        }),
      )
      expect(complete.ETag).toMatch(MULTIPART_ETAG_RE)

      const downloaded = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: KeySameIdx }),
      )
      const body = Buffer.from(await downloaded.Body!.transformToByteArray())
      expect(body).toEqual(PartA)
    }, 30_000)

    // Distinct parts uploaded in parallel must still assemble in PartNumber
    // order. Best-effort: timing-dependent, so it catches a missing lock only
    // stochastically.
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

  // ── Decision lock: bucket-level ops fold into default-bucket object ops ─────
  // A true S3 CreateBucket/DeleteBucket/HeadBucket targets a bare `/{bucket}`
  // with no object key. Because the first path segment is folded into the
  // bucket name (parseBucketAndKey), such a request is indistinguishable from a
  // flat, default-bucket object op — the semantics the bucket-support migration
  // and legacy flat keys rely on. Bucket endpoints are therefore left
  // unimplemented, and clients must set `no_check_bucket = true` so they never
  // emit CreateBucket/HeadBucket. These tests lock
  // that decision: a bare, slash-less PUT/HEAD/DELETE is handled as a
  // default-bucket object op, so adopting a "no-slash = bucket op" rule later is
  // a conscious, test-breaking change rather than a silent regression.
  describe('Bucket-level ops fold into default-bucket object ops', () => {
    const S3_BASE = `${BASE_PATH}/s3`
    // Mirrors the raw-HTTP auth pattern above: handleS3Auth only needs a
    // `Credential=<alphanumeric>/` and AuthManager is mocked to return `user`.
    const AUTH =
      'AWS4-HMAC-SHA256 Credential=buckettestkey/20200101/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=deadbeef'
    const raw = (method: string, path: string, body?: Uint8Array) =>
      fetch(`${S3_BASE}${path}`, {
        method,
        headers: { Authorization: AUTH },
        body: body as unknown as BodyInit | undefined,
      })

    it('PUT of a bare, slash-less name stores a default-bucket object (not CreateBucket)', async () => {
      const body = Buffer.from('looks like a bucket, stored as an object')
      const put = await raw('PUT', '/looks-like-a-bucket', body)
      expect(put.status).toBe(200)
      expect(put.headers.get('etag')).toMatch(MD5_ETAG_RE)

      // Retrievable as the object 'looks-like-a-bucket' in the default bucket —
      // proof the PUT was an object write, not a no-op bucket creation.
      const get = await raw('GET', '/looks-like-a-bucket')
      expect(get.status).toBe(200)
      expect(Buffer.from(await get.arrayBuffer())).toEqual(body)
    }, 15_000)

    it('HEAD of a bare, slash-less name returns default-bucket object metadata (200), not HeadBucket', async () => {
      // A missing-name HEAD would 404 either way — HeadObject (NoSuchKey) and
      // HeadBucket (NoSuchBucket) both return 404 — so that alone locks
      // nothing. Instead seed a bare object and HEAD the same bare path:
      // HeadObject answers 200 with the object's Content-Length and MD5 ETag,
      // whereas HeadBucket returns neither, so a future "no-slash = bucket op"
      // rule would break these assertions.
      const body = Buffer.from('bare-head-target')
      expect((await raw('PUT', '/bare-head-target', body)).status).toBe(200)

      const head = await raw('HEAD', '/bare-head-target')
      expect(head.status).toBe(200)
      expect(head.headers.get('content-length')).toBe(String(body.length))
      expect(head.headers.get('etag')).toMatch(MD5_ETAG_RE)
    }, 15_000)

    it('DELETE of a bare, slash-less name is DeleteObject (soft-delete, 204), not DeleteBucket', async () => {
      // Seed a bare object, then DELETE the same bare path. DeleteObject
      // soft-deletes it and answers 204 (idempotent), after which a GET 404s —
      // proof the object, not a bucket, was the target. A DeleteBucket would
      // instead 404 (NoSuchBucket) on this never-created bucket and leave the
      // object reachable, so a future "no-slash = bucket op" rule would break
      // these assertions.
      const body = Buffer.from('bare-delete-target')
      expect((await raw('PUT', '/bare-delete-target', body)).status).toBe(200)

      const del = await raw('DELETE', '/bare-delete-target')
      expect(del.status).toBe(204)

      expect((await raw('GET', '/bare-delete-target')).status).toBe(404)
    }, 15_000)
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

  // DeleteObject soft-deletes the (bucket, key) mapping: the S3 name is hidden
  // but the underlying content is never removed from the DSN. This is what makes
  // rclone delete/move/sync work while preserving permanence.
  describe('DeleteObject (soft delete)', () => {
    const DelListBucket = `${BASE_PATH}/s3/del-test`

    it('returns 204 and the object is then hidden from GET, HEAD and listings', async () => {
      const Del = 'del-test/gone.txt'
      await s3Client.send(
        new PutObjectCommand({ Bucket, Key: Del, Body: Buffer.from('bye') }),
      )
      // Present before deletion.
      await expect(
        s3Client.send(new HeadObjectCommand({ Bucket, Key: Del })),
      ).resolves.toBeDefined()

      const del = await s3Client.send(
        new DeleteObjectCommand({ Bucket, Key: Del }),
      )
      expect(del.$metadata.httpStatusCode).toBe(204)

      await expect(
        s3Client.send(new GetObjectCommand({ Bucket, Key: Del })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
      await expect(
        s3Client.send(new HeadObjectCommand({ Bucket, Key: Del })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })

      const list = await s3Client.send(
        new ListObjectsV2Command({ Bucket: DelListBucket }),
      )
      expect((list.Contents ?? []).some((o) => o.Key === 'gone.txt')).toBe(false)
    })

    it('deleting a missing key succeeds (idempotent)', async () => {
      const del = await s3Client.send(
        new DeleteObjectCommand({ Bucket, Key: 'del-test/never-existed.txt' }),
      )
      expect(del.$metadata.httpStatusCode).toBe(204)
    })

    it('re-uploading a deleted key resurrects it with the new content', async () => {
      const Res = 'del-test/resurrect.txt'
      await s3Client.send(
        new PutObjectCommand({ Bucket, Key: Res, Body: Buffer.from('v1') }),
      )
      await s3Client.send(new DeleteObjectCommand({ Bucket, Key: Res }))
      await expect(
        s3Client.send(new GetObjectCommand({ Bucket, Key: Res })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })

      // PUT to the same key after DELETE re-creates the object.
      await s3Client.send(
        new PutObjectCommand({ Bucket, Key: Res, Body: Buffer.from('v2') }),
      )
      const got = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: Res }),
      )
      expect(Buffer.from(await got.Body!.transformToByteArray()).toString()).toBe(
        'v2',
      )
    })
  })

  // Server-side copy is a content-addressed remap (destination key -> same CID),
  // so it needs no data transfer. rclone implements Move as Copy + Delete, so
  // these two together give move/rename.
  describe('CopyObject and Move', () => {
    it('server-side copies an object to a new key', async () => {
      const Src = 'copy-test/src.txt'
      const Dst = 'copy-test/dst.txt'
      const Content = Buffer.from('copy me')
      const put = await s3Client.send(
        new PutObjectCommand({ Bucket, Key: Src, Body: Content }),
      )

      const copy = await s3Client.send(
        new CopyObjectCommand({ Bucket, Key: Dst, CopySource: Src }),
      )
      expect(copy.$metadata.httpStatusCode).toBe(200)

      // Destination is readable and byte-identical to the source.
      const got = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: Dst }),
      )
      expect(Buffer.from(await got.Body!.transformToByteArray())).toEqual(
        Content,
      )
      // Same content => same MD5 ETag as the source.
      expect(got.ETag).toBe(put.ETag)
      // Source is untouched.
      await expect(
        s3Client.send(new HeadObjectCommand({ Bucket, Key: Src })),
      ).resolves.toBeDefined()
    })

    it('move (copy + delete source) leaves only the destination', async () => {
      const Src = 'copy-test/move-src.txt'
      const Dst = 'copy-test/move-dst.txt'
      const Content = Buffer.from('move me')
      await s3Client.send(
        new PutObjectCommand({ Bucket, Key: Src, Body: Content }),
      )

      // rclone move = server-side copy then delete-source.
      await s3Client.send(
        new CopyObjectCommand({ Bucket, Key: Dst, CopySource: Src }),
      )
      await s3Client.send(new DeleteObjectCommand({ Bucket, Key: Src }))

      // Source gone, destination intact — deleting the source did NOT hide the
      // destination even though both point at the same CID.
      await expect(
        s3Client.send(new GetObjectCommand({ Bucket, Key: Src })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
      const got = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: Dst }),
      )
      expect(Buffer.from(await got.Body!.transformToByteArray())).toEqual(
        Content,
      )
    })

    it('returns 404 NoSuchKey when the copy source does not exist', async () => {
      await expect(
        s3Client.send(
          new CopyObjectCommand({
            Bucket,
            Key: 'copy-test/dst2.txt',
            CopySource: 'copy-test/does-not-exist.txt',
          }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
    })
  })

  describe('AbortMultipartUpload', () => {
    it('aborts an in-progress upload; completing it afterwards fails', async () => {
      const AbortKey = 'abort-me.bin'
      const created = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: AbortKey }),
      )
      const UploadId = created.UploadId!

      const part = await s3Client.send(
        new UploadPartCommand({
          Bucket,
          Key: AbortKey,
          UploadId,
          PartNumber: 1,
          Body: Buffer.alloc(16 * 1024, 'x'),
        }),
      )

      const abort = await s3Client.send(
        new AbortMultipartUploadCommand({ Bucket, Key: AbortKey, UploadId }),
      )
      expect(abort.$metadata.httpStatusCode).toBe(204)

      // The aborted upload no longer exists — completing it must fail.
      await expect(
        s3Client.send(
          new CompleteMultipartUploadCommand({
            Bucket,
            Key: AbortKey,
            UploadId,
            MultipartUpload: {
              Parts: [{ ETag: part.ETag!, PartNumber: 1 }],
            },
          }),
        ),
      ).rejects.toThrow()

      // And the object was never created.
      await expect(
        s3Client.send(new HeadObjectCommand({ Bucket, Key: AbortKey })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
    })

    // S3 clients issue Abort after a successful Complete on retry/cleanup. That
    // must NOT tear down the just-completed object (whose nodes may still be
    // migrating) — per the S3 spec it returns NoSuchUpload, and the object stays.
    it('aborting an already-completed upload returns 404 and leaves the object intact', async () => {
      const Key2 = 'abort-after-complete.bin'
      const created = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: Key2 }),
      )
      const UploadId = created.UploadId!
      const part = await s3Client.send(
        new UploadPartCommand({
          Bucket,
          Key: Key2,
          UploadId,
          PartNumber: 1,
          Body: Buffer.alloc(16 * 1024, 'y'),
        }),
      )
      await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: Key2,
          UploadId,
          MultipartUpload: { Parts: [{ ETag: part.ETag!, PartNumber: 1 }] },
        }),
      )

      // Abort after Complete → NoSuchUpload (404), not a teardown.
      await expect(
        s3Client.send(
          new AbortMultipartUploadCommand({ Bucket, Key: Key2, UploadId }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })

      // The completed object is still there.
      await expect(
        s3Client.send(new HeadObjectCommand({ Bucket, Key: Key2 })),
      ).resolves.toBeDefined()
    })
  })

  // rclone stores the source file's modification time in x-amz-meta-mtime (a
  // float unix-seconds string) and reads it back via HEAD; SetModTime is a
  // server-side copy of the object onto itself with metadata REPLACE.
  describe('Modification time (x-amz-meta-mtime)', () => {
    it('round-trips the mtime metadata through PutObject and HeadObject', async () => {
      const MtimeKey = 'mtime-test/file.txt'
      const Mtime = '1620000000.123456789'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key: MtimeKey,
          Body: Buffer.from('with mtime'),
          Metadata: { mtime: Mtime },
        }),
      )

      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket, Key: MtimeKey }),
      )
      // Echoed back verbatim, full precision preserved.
      expect(head.Metadata?.mtime).toBe(Mtime)
    })

    it('updates the mtime via a metadata-REPLACE copy onto the same key (SetModTime)', async () => {
      const Key2 = 'mtime-test/setmodtime.txt'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key: Key2,
          Body: Buffer.from('set mod time'),
          Metadata: { mtime: '1000000000.5' },
        }),
      )

      const NewMtime = '1699999999.987654321'
      await s3Client.send(
        new CopyObjectCommand({
          Bucket,
          Key: Key2,
          CopySource: Key2,
          MetadataDirective: 'REPLACE',
          Metadata: { mtime: NewMtime },
        }),
      )

      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket, Key: Key2 }),
      )
      expect(head.Metadata?.mtime).toBe(NewMtime)
    })

    it('a plain server-side copy inherits the source mtime', async () => {
      const Src = 'mtime-test/inherit-src.txt'
      const Dst = 'mtime-test/inherit-dst.txt'
      const Mtime = '1500000000.25'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key: Src,
          Body: Buffer.from('inherit'),
          Metadata: { mtime: Mtime },
        }),
      )
      await s3Client.send(
        new CopyObjectCommand({ Bucket, Key: Dst, CopySource: Src }),
      )

      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket, Key: Dst }),
      )
      expect(head.Metadata?.mtime).toBe(Mtime)
    })

    // A metadata-REPLACE copy defines the destination's metadata explicitly, so
    // omitting mtime means the destination has none — it must NOT inherit the
    // source's mtime (that's COPY behaviour).
    it('a metadata-REPLACE copy without mtime clears it (does not inherit source)', async () => {
      const Src = 'mtime-test/replace-src.txt'
      const Dst = 'mtime-test/replace-dst.txt'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key: Src,
          Body: Buffer.from('replace-clear'),
          Metadata: { mtime: '1500000000.25' },
        }),
      )
      await s3Client.send(
        new CopyObjectCommand({
          Bucket,
          Key: Dst,
          CopySource: Src,
          MetadataDirective: 'REPLACE',
          // No mtime in the replacement metadata.
        }),
      )

      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket, Key: Dst }),
      )
      expect(head.Metadata?.mtime).toBeUndefined()
    })
  })

  // S3 stores object metadata (system headers + arbitrary x-amz-meta-*) once at
  // write and returns it verbatim on GET/HEAD; CopyObject carries or replaces it
  // per the metadata directive. See issue #786.
  describe('Object metadata', () => {
    it('returns the stored Content-Type byte-for-byte, with no injected charset', async () => {
      const Key = 'metadata-test/verbatim.csv'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: Buffer.from('a,b,c\n1,2,3'),
          ContentType: 'text/csv',
        }),
      )

      const head = await s3Client.send(new HeadObjectCommand({ Bucket, Key }))
      // Previously came back as "text/csv; charset=utf-8" (Express appended the
      // charset). It must now be exactly what was written.
      expect(head.ContentType).toBe('text/csv')

      const get = await s3Client.send(new GetObjectCommand({ Bucket, Key }))
      expect(get.ContentType).toBe('text/csv')
    })

    it('preserves an explicit charset in the Content-Type', async () => {
      const Key = 'metadata-test/charset.txt'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: Buffer.from('hola'),
          ContentType: 'text/plain; charset=iso-8859-1',
        }),
      )

      const head = await s3Client.send(new HeadObjectCommand({ Bucket, Key }))
      expect(head.ContentType).toBe('text/plain; charset=iso-8859-1')
    })

    it('round-trips system metadata (Cache-Control, Content-Language, Content-Disposition)', async () => {
      const Key = 'metadata-test/system.txt'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: Buffer.from('sys'),
          CacheControl: 'max-age=3600, public',
          ContentLanguage: 'en-GB',
          ContentDisposition: 'attachment; filename="report.txt"',
        }),
      )

      const head = await s3Client.send(new HeadObjectCommand({ Bucket, Key }))
      expect(head.CacheControl).toBe('max-age=3600, public')
      expect(head.ContentLanguage).toBe('en-GB')
      expect(head.ContentDisposition).toBe('attachment; filename="report.txt"')
    })

    it('round-trips arbitrary user metadata (x-amz-meta-*)', async () => {
      const Key = 'metadata-test/user.txt'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: Buffer.from('user'),
          Metadata: { author: 'alice', project: 'auto-drive' },
        }),
      )

      const head = await s3Client.send(new HeadObjectCommand({ Bucket, Key }))
      expect(head.Metadata?.author).toBe('alice')
      expect(head.Metadata?.project).toBe('auto-drive')
    })

    it('round-trips Content-Encoding for a non-internally-compressed object', async () => {
      const Key = 'metadata-test/encoding.txt'
      // A client declaring Content-Encoding: gzip sends actually-gzipped bytes
      // (the raw body-parser inflates per Content-Encoding, so an unencoded body
      // with this header would be rejected as malformed — correct HTTP). The
      // encoding is stored as metadata and returned verbatim; Auto Drive is not
      // internally compressing this object, so it owns Content-Encoding.
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: gzipSync(Buffer.from('encoded')),
          ContentEncoding: 'gzip',
        }),
      )

      const head = await s3Client.send(new HeadObjectCommand({ Bucket, Key }))
      expect(head.ContentEncoding).toBe('gzip')
    })

    it('carries metadata through a plain (COPY-directive) server-side copy', async () => {
      const Src = 'metadata-test/copy-src.csv'
      const Dst = 'metadata-test/copy-dst.csv'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key: Src,
          Body: Buffer.from('x'),
          ContentType: 'text/csv',
          CacheControl: 'max-age=60',
          Metadata: { origin: 'src' },
        }),
      )
      await s3Client.send(
        new CopyObjectCommand({ Bucket, Key: Dst, CopySource: Src }),
      )

      const head = await s3Client.send(new HeadObjectCommand({ Bucket, Key: Dst }))
      expect(head.ContentType).toBe('text/csv')
      expect(head.CacheControl).toBe('max-age=60')
      expect(head.Metadata?.origin).toBe('src')
    })

    it('replaces metadata on a REPLACE-directive copy', async () => {
      const Src = 'metadata-test/replace-src.csv'
      const Dst = 'metadata-test/replace-dst.json'
      await s3Client.send(
        new PutObjectCommand({
          Bucket,
          Key: Src,
          Body: Buffer.from('x'),
          ContentType: 'text/csv',
          Metadata: { origin: 'src' },
        }),
      )
      await s3Client.send(
        new CopyObjectCommand({
          Bucket,
          Key: Dst,
          CopySource: Src,
          MetadataDirective: 'REPLACE',
          ContentType: 'application/json',
          Metadata: { origin: 'dst' },
        }),
      )

      const head = await s3Client.send(new HeadObjectCommand({ Bucket, Key: Dst }))
      expect(head.ContentType).toBe('application/json')
      expect(head.Metadata?.origin).toBe('dst')
    })

    it('persists metadata supplied on CreateMultipartUpload', async () => {
      const Key = 'metadata-test/multipart.bin'
      const create = await s3Client.send(
        new CreateMultipartUploadCommand({
          Bucket,
          Key,
          ContentType: 'application/x-custom',
          CacheControl: 'no-store',
          Metadata: { part: 'meta' },
        }),
      )
      const uploadId = create.UploadId
      const part = await s3Client.send(
        new UploadPartCommand({
          Bucket,
          Key,
          UploadId: uploadId,
          PartNumber: 1,
          Body: Buffer.from('multipart body bytes'),
        }),
      )
      await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key,
          UploadId: uploadId,
          MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag }] },
        }),
      )

      const head = await s3Client.send(new HeadObjectCommand({ Bucket, Key }))
      expect(head.ContentType).toBe('application/x-custom')
      expect(head.CacheControl).toBe('no-store')
      expect(head.Metadata?.part).toBe('meta')
    })
  })

  // Versioned-WORM (issue #781): versioning is always on, versionId = the
  // content CID, DeleteObject writes a delete marker (hides the key, keeps
  // history), and destroying a specific version is refused. Object Lock is
  // advertised as an honest COMPLIANCE lock.
  describe('Versioning and Object Lock (WORM)', () => {
    // Bucket-level ops address the bucket via the URL (as ListObjectsV2 does);
    // object ops use the shared endpoint Bucket + a versions-test/* key.
    const VBucket = `${BASE_PATH}/s3/versions-test`

    const putVersion = (key: string, body: string) =>
      s3Client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: Buffer.from(body) }),
      )

    it('reports bucket versioning as Enabled', async () => {
      const res = await s3Client.send(
        new GetBucketVersioningCommand({ Bucket: VBucket }),
      )
      expect(res.Status).toBe('Enabled')
    })

    it('advertises an Enabled COMPLIANCE Object Lock configuration', async () => {
      const res = await s3Client.send(
        new GetObjectLockConfigurationCommand({ Bucket: VBucket }),
      )
      expect(res.ObjectLockConfiguration?.ObjectLockEnabled).toBe('Enabled')
      expect(
        res.ObjectLockConfiguration?.Rule?.DefaultRetention?.Mode,
      ).toBe('COMPLIANCE')
    })

    it('reports a COMPLIANCE 100-year retention for an object', async () => {
      const key = 'versions-test/retention.txt'
      await putVersion(key, 'retained')
      const res = await s3Client.send(
        new GetObjectRetentionCommand({ Bucket, Key: key }),
      )
      expect(res.Retention?.Mode).toBe('COMPLIANCE')
      // The 100-year COMPLIANCE window from the write (this run): effectively
      // permanent, and consistent with the bucket's Years=100 default. Allow a
      // one-year slack for the (unlikely) New-Year boundary between write & now.
      const nowYear = new Date().getUTCFullYear()
      const retainYear = res.Retention?.RetainUntilDate?.getUTCFullYear() ?? 0
      expect(retainYear).toBeGreaterThanOrEqual(nowYear + 99)
      expect(retainYear).toBeLessThanOrEqual(nowYear + 100)
    })

    it('returns the version id (= CID) on PutObject and stacks a new version per overwrite', async () => {
      const key = 'versions-test/stack.txt'
      const v1 = await putVersion(key, 'v1')
      const v2 = await putVersion(key, 'v2-different')

      expect(v1.VersionId).toBeTruthy()
      expect(v2.VersionId).toBeTruthy()
      // Distinct content ⇒ distinct CID ⇒ distinct versionId.
      expect(v1.VersionId).not.toBe(v2.VersionId)

      const list = await s3Client.send(
        new ListObjectVersionsCommand({ Bucket: VBucket, Prefix: 'stack.txt' }),
      )
      const forKey = (list.Versions ?? []).filter((v) => v.Key === 'stack.txt')
      expect(forKey.length).toBeGreaterThanOrEqual(2)
      // The overwrite is the latest version.
      const latest = forKey.find((v) => v.IsLatest)
      expect(latest?.VersionId).toBe(v2.VersionId)
      expect(list.DeleteMarkers ?? []).not.toContainEqual(
        expect.objectContaining({ Key: 'stack.txt' }),
      )
    })

    it('collapses repeated same-content writes into one version entry', async () => {
      // versionId = CID: writing identical bytes twice yields the same versionId,
      // so ListObjectVersions must show ONE entry for it, not a duplicate.
      const key = 'versions-test/dedup.txt'
      const a = await putVersion(key, 'identical-bytes')
      const b = await putVersion(key, 'identical-bytes')
      expect(a.VersionId).toBe(b.VersionId)

      const list = await s3Client.send(
        new ListObjectVersionsCommand({ Bucket: VBucket, Prefix: 'dedup.txt' }),
      )
      const forKey = (list.Versions ?? []).filter((v) => v.Key === 'dedup.txt')
      expect(forKey).toHaveLength(1)
      expect(forKey[0].VersionId).toBe(a.VersionId)
      expect(forKey[0].IsLatest).toBe(true)
    })

    it('serves an older version by versionId', async () => {
      const key = 'versions-test/read-old.txt'
      const v1 = await putVersion(key, 'old-content')
      await putVersion(key, 'new-content')

      // Current read returns the newest content.
      const current = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: key }),
      )
      expect(
        Buffer.from(await current.Body!.transformToByteArray()).toString(),
      ).toBe('new-content')

      // Reading v1 by its CID returns the original bytes.
      const old = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: key, VersionId: v1.VersionId }),
      )
      expect(
        Buffer.from(await old.Body!.transformToByteArray()).toString(),
      ).toBe('old-content')
    })

    it('refuses to destroy a specific version (403 AccessDenied)', async () => {
      const key = 'versions-test/no-destroy.txt'
      const v = await putVersion(key, 'immutable')

      let status: number | undefined
      let code: string | undefined
      try {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket, Key: key, VersionId: v.VersionId }),
        )
        throw new Error('expected the versioned delete to be refused')
      } catch (e) {
        const err = e as {
          $metadata?: { httpStatusCode?: number }
          name?: string
        }
        status = err.$metadata?.httpStatusCode
        code = err.name
      }
      expect(status).toBe(403)
      expect(code).toBe('AccessDenied')

      // The version is still readable — it was never destroyed.
      const still = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: key, VersionId: v.VersionId }),
      )
      expect(
        Buffer.from(await still.Body!.transformToByteArray()).toString(),
      ).toBe('immutable')
    })

    it('a bare DeleteObject hides the key but keeps the history behind a delete marker', async () => {
      const key = 'versions-test/marker.txt'
      const v1 = await putVersion(key, 'oldest')
      await putVersion(key, 'newest-then-deleted')

      const del = await s3Client.send(
        new DeleteObjectCommand({ Bucket, Key: key }),
      )
      // Soft-delete: succeeds (204-class), never destroys content.
      expect(del.$metadata.httpStatusCode).toBe(204)
      // Versioning-aware clients must see that a delete MARKER was written (not a
      // destructive remove): x-amz-delete-marker + the marker's versionId.
      expect(del.DeleteMarker).toBe(true)
      expect(del.VersionId).toMatch(/^dm-\d+$/)

      // The key is hidden from a normal read.
      await expect(
        s3Client.send(new HeadObjectCommand({ Bucket, Key: key })),
      ).rejects.toThrow()

      // ...but the version history survives, with a delete marker as latest and
      // both content versions still listed.
      const list = await s3Client.send(
        new ListObjectVersionsCommand({ Bucket: VBucket, Prefix: 'marker.txt' }),
      )
      const versions = (list.Versions ?? []).filter((v) => v.Key === 'marker.txt')
      expect(versions.length).toBeGreaterThanOrEqual(2)
      const markers = (list.DeleteMarkers ?? []).filter(
        (m) => m.Key === 'marker.txt',
      )
      expect(markers.length).toBe(1)
      expect(markers[0].IsLatest).toBe(true)
      // No content version is latest once the marker is on top.
      expect(versions.every((v) => !v.IsLatest)).toBe(true)

      // An older, non-current version is still retrievable by versionId despite
      // the marker (the deleting delete only Trashed the current version's CID;
      // moderation/removal applies per CID to retrieval, not to listing).
      const old = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: key, VersionId: v1.VersionId }),
      )
      expect(
        Buffer.from(await old.Body!.transformToByteArray()).toString(),
      ).toBe('oldest')
    })

    it('a repeat DeleteObject on an already-deleted key still returns delete-marker headers', async () => {
      const key = 'versions-test/repeat-delete.txt'
      await putVersion(key, 'content')

      const first = await s3Client.send(
        new DeleteObjectCommand({ Bucket, Key: key }),
      )
      expect(first.DeleteMarker).toBe(true)
      const firstVersionId = first.VersionId
      expect(firstVersionId).toMatch(/^dm-\d+$/)

      // Deleting again: no new marker is created, but the current state IS a
      // delete marker, so the response must still say so (same marker id).
      const second = await s3Client.send(
        new DeleteObjectCommand({ Bucket, Key: key }),
      )
      expect(second.$metadata.httpStatusCode).toBe(204)
      expect(second.DeleteMarker).toBe(true)
      expect(second.VersionId).toBe(firstVersionId)
    })

    it('a moderated/removed version’s CID is not retrievable via versionId', async () => {
      // DeleteObject on the sole key moves that content to the web-app Trash
      // (owner-removal), so retrieval of that exact version is blocked even
      // though the version is retained and still listed.
      const key = 'versions-test/removed.txt'
      const v = await putVersion(key, 'gone-on-delete')
      await s3Client.send(new DeleteObjectCommand({ Bucket, Key: key }))

      await expect(
        s3Client.send(
          new GetObjectCommand({ Bucket, Key: key, VersionId: v.VersionId }),
        ),
      ).rejects.toThrow()

      // Retention ≠ retrieval: the version is still enumerated in the history.
      const list = await s3Client.send(
        new ListObjectVersionsCommand({
          Bucket: VBucket,
          Prefix: 'removed.txt',
        }),
      )
      expect(
        (list.Versions ?? []).some((ver) => ver.VersionId === v.VersionId),
      ).toBe(true)
    })
  })

  describe('Missing keys', () => {
    const MissingKey = 'this-key-was-never-uploaded-' + Date.now() + '.txt'

    it('GetObject on a missing key should return 404', async () => {
      const command = new GetObjectCommand({ Bucket, Key: MissingKey })
      await expect(s3Client.send(command)).rejects.toMatchObject({
        $metadata: { httpStatusCode: 404 },
      })
    })

    it('HeadObject on a missing key should return 404', async () => {
      const command = new HeadObjectCommand({ Bucket, Key: MissingKey })
      await expect(s3Client.send(command)).rejects.toMatchObject({
        $metadata: { httpStatusCode: 404 },
      })
    })
  })

  // These remain unimplemented and must return 501, never reach a write handler.
  describe('Unsupported operations return 501 NotImplemented', () => {
    it('ListParts is rejected (must not finalise the upload)', async () => {
      // A real, in-progress upload so a misroute would actually complete it.
      const created = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: 'listparts-probe.bin' }),
      )
      await expect(
        s3Client.send(
          new ListPartsCommand({
            Bucket,
            Key: 'listparts-probe.bin',
            UploadId: created.UploadId!,
          }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 501 } })
    })

    it('ListMultipartUploads is rejected', async () => {
      await expect(
        s3Client.send(new ListMultipartUploadsCommand({ Bucket })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 501 } })
    })

    // UploadPartCopy (a multipart part sourced from another object, used by
    // rclone's server-side copy of very large files) must 501, NOT be misrouted
    // to UploadPart — which would read an empty body and corrupt the object.
    it('UploadPartCopy is rejected with 501 (not misrouted to UploadPart)', async () => {
      const created = await s3Client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: 'uploadpartcopy.bin' }),
      )
      await expect(
        s3Client.send(
          new UploadPartCopyCommand({
            Bucket,
            Key: 'uploadpartcopy.bin',
            UploadId: created.UploadId!,
            PartNumber: 1,
            CopySource: `${Key}`,
          }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 501 } })
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

    // HeadObject must return 200 with the headers GET would send. A prior
    // 204 stripped Content-Length/Content-Type; Last-Modified was never set.
    it('should return ContentLength, ContentType and LastModified on HeadObject', async () => {
      // `Key`/`Body` is a plain (uncompressed, unencrypted) object.
      const result = await s3Client.send(new HeadObjectCommand({ Bucket, Key }))

      expect(result.ContentLength).toBe(Body.length)
      expect(result.LastModified).toBeInstanceOf(Date)
      expect(result.ContentType).toBeTruthy()
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

  // The S3 namespace is scoped per user: (owner, bucket, key). Two users can
  // each own the same (bucket, key) with no contention — the first-writer-wins
  // squatting / 403 behaviour of a global namespace is gone — and neither can
  // see or affect the other's key.
  describe('Per-user namespace isolation', () => {
    // The suite's `s3Client` authenticates as `user`; clientB uses a second key
    // that resolves to a second user.
    const userBKey = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'
    let userB: typeof user
    let clientB: S3Client
    const IsoKey = 'iso-test/shared.txt'

    beforeAll(async () => {
      userB = createMockUser()
      await AccountsUseCases.getOrCreateAccount(userB)
      // Resolve the API key to distinct principals so A and B are separate.
      // handleAuth calls getUserFromAccessToken(provider, accessToken); the
      // access token is the SigV4 access-key id, so key off the second arg.
      jest
        .spyOn(AuthManager, 'getUserFromAccessToken')
        .mockImplementation((_provider, accessToken) =>
          Promise.resolve(accessToken === userBKey ? userB : user),
        )
      clientB = new S3Client({
        region: 'us-east-1',
        endpoint: `${BASE_PATH}/s3`,
        credentials: { accessKeyId: userBKey, secretAccessKey: '' },
        bucketEndpoint: true,
      })
    })

    afterAll(() => {
      // Restore the single-user mock for any later suites.
      jest.spyOn(AuthManager, 'getUserFromAccessToken').mockResolvedValue(user)
    })

    it('two users can own the same (bucket, key) independently', async () => {
      await s3Client.send(
        new PutObjectCommand({ Bucket, Key: IsoKey, Body: Buffer.from('A owns this') }),
      )
      await clientB.send(
        new PutObjectCommand({ Bucket, Key: IsoKey, Body: Buffer.from('B owns a different thing') }),
      )

      const aGet = await s3Client.send(
        new GetObjectCommand({ Bucket, Key: IsoKey }),
      )
      const bGet = await clientB.send(
        new GetObjectCommand({ Bucket, Key: IsoKey }),
      )
      expect(Buffer.from(await aGet.Body!.transformToByteArray()).toString()).toBe(
        'A owns this',
      )
      expect(Buffer.from(await bGet.Body!.transformToByteArray()).toString()).toBe(
        'B owns a different thing',
      )
    })

    it('one user deleting their key does not affect the other', async () => {
      await s3Client.send(new DeleteObjectCommand({ Bucket, Key: IsoKey }))

      // A's key is gone…
      await expect(
        s3Client.send(new GetObjectCommand({ Bucket, Key: IsoKey })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
      // …but B's identically-named key is untouched.
      const bGet = await clientB.send(
        new GetObjectCommand({ Bucket, Key: IsoKey }),
      )
      expect(Buffer.from(await bGet.Body!.transformToByteArray()).toString()).toBe(
        'B owns a different thing',
      )
    })
  })
})
