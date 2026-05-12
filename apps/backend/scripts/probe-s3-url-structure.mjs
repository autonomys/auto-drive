/**
 * Probe script: what URLs does the AWS S3 SDK send for different bucket/key configs?
 *
 * This answers: does the bucket name appear in the request path or not?
 * Run with: node scripts/probe-s3-url-structure.mjs
 */

import http from 'http'
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  ListBucketsCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

// --- Minimal capture server ---

const captured = []

const server = http.createServer((req, res) => {
  captured.push({ method: req.method, url: req.url })
  // Return a plausible S3 XML response for each method so the SDK doesn't error
  res.setHeader('Content-Type', 'application/xml')
  if (req.method === 'GET' && req.url === '/') {
    res.end(`<?xml version="1.0"?>
      <ListAllMyBucketsResult>
        <Buckets><Bucket><Name>default</Name><CreationDate>2026-01-01T00:00:00Z</CreationDate></Bucket></Buckets>
      </ListAllMyBucketsResult>`)
  } else if (req.method === 'GET') {
    res.end(`<?xml version="1.0"?>
      <ListBucketResult><Name>default</Name><Contents></Contents></ListBucketResult>`)
  } else if (req.method === 'PUT') {
    res.setHeader('ETag', '"abc123"')
    res.end()
  } else if (req.method === 'DELETE') {
    res.statusCode = 403
    res.end(`<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>`)
  } else {
    res.end()
  }
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const endpoint = `http://127.0.0.1:${port}`

console.log(`Capture server listening on ${endpoint}\n`)

// --- Helper ---

async function probe(label, clientConfig, commands) {
  captured.length = 0
  const client = new S3Client({ region: 'us-east-1', ...clientConfig })
  for (const cmd of commands) {
    try { await client.send(cmd) } catch { /* ignore SDK errors, we only care about the URL */ }
  }
  console.log(`=== ${label} ===`)
  for (const r of captured) {
    console.log(`  ${r.method.padEnd(7)} ${r.url}`)
  }
  console.log()
}

// --- Scenario 1: Current rclone config (bucket_endpoint = true in rclone terms) ---
// The integration test uses bucketEndpoint:true with Bucket = full URL.
// This simulates: endpoint = http://host/api/s3, bucket = that full URL.

await probe(
  'Scenario 1: bucketEndpoint:true, Bucket = full endpoint URL (current integration test style)',
  {
    endpoint,
    forcePathStyle: false,
    bucketEndpoint: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  },
  [
    new PutObjectCommand({ Bucket: endpoint, Key: 'my-archive/file.txt', Body: 'hello' }),
    new ListObjectsV2Command({ Bucket: endpoint, Prefix: 'my-archive/' }),
    new ListBucketsCommand({}),
  ]
)

// --- Scenario 2: Path-style, explicit bucket name in Bucket param ---
// This simulates what rclone does with a named bucket like "default"
// and endpoint = http://host/api/s3 without bucket_endpoint.

await probe(
  'Scenario 2: forcePathStyle:true, Bucket = "default", key = "my-archive/file.txt"',
  {
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  },
  [
    new PutObjectCommand({ Bucket: 'default', Key: 'my-archive/file.txt', Body: 'hello' }),
    new ListObjectsV2Command({ Bucket: 'default', Prefix: 'my-archive/' }),
    new ListBucketsCommand({}),
  ]
)

// --- Scenario 3: Path-style, different bucket names ---
// What if rclone sends bucket name as first path segment?

await probe(
  'Scenario 3: forcePathStyle:true, Bucket = "my-archive", key = "file.txt"',
  {
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  },
  [
    new PutObjectCommand({ Bucket: 'my-archive', Key: 'file.txt', Body: 'hello' }),
    new PutObjectCommand({ Bucket: 'reports', Key: 'q1.pdf', Body: 'hello' }),
    new ListObjectsV2Command({ Bucket: 'my-archive', Delimiter: '/' }),
    new ListBucketsCommand({}),
  ]
)

// --- Scenario 4: bucketEndpoint:true, Bucket = endpoint + "/default" ---
// What if rclone constructs the bucket endpoint as endpoint + "/" + bucketName?

await probe(
  'Scenario 4: bucketEndpoint:true, Bucket = endpoint + "/default"',
  {
    endpoint,
    forcePathStyle: false,
    bucketEndpoint: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  },
  [
    new PutObjectCommand({ Bucket: `${endpoint}/default`, Key: 'my-archive/file.txt', Body: 'hello' }),
    new ListObjectsV2Command({ Bucket: `${endpoint}/default`, Prefix: 'my-archive/' }),
  ]
)

server.close()
console.log('Done.')
