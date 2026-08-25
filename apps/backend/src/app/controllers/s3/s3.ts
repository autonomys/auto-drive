import { S3UseCases } from '../../../core/s3/index.js'
import { HttpError, ForbiddenError } from '../../../errors/index.js'
import {
  UploadCompletionInProgressError,
  UploadPartsChangedError,
} from '../../../core/uploads/errors.js'
import { handleS3Auth } from './auth.js'
import {
  ByteRange,
  DownloadMetadata,
  handleDownloadResponseHeaders,
  handleS3DownloadResponseHeaders,
} from '@autonomys/file-server'
import { pipeline } from 'stream'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import { NextFunction, Request, Response } from 'express'
import { encodeS3Key, planListingEncoding, sendXML } from './utils.js'
import js2xmlparser from 'js2xmlparser'
import { XMLParser } from 'fast-xml-parser'
import { UploadOptions, UserWithOrganization } from '@auto-drive/models'
import {
  CompressionAlgorithm,
  EncryptionAlgorithm,
} from '@autonomys/auto-dag-data'
import { S3ObjectMetadata } from '../../../infrastructure/repositories/s3/objectMappings.js'

const logger = createLogger('s3:controllers')

/**
 * Parse the bucket name and object key from a raw S3 request path.
 *
 * The first path segment is the bucket name; everything after the first '/'
 * is the key. Keys with no '/' are assigned to the 'default' bucket so that
 * objects uploaded before bucket support was introduced remain accessible.
 *
 * Examples:
 *   'my-archive/file.txt'     → { bucket: 'my-archive', key: 'file.txt' }
 *   'my-archive/sub/file.txt' → { bucket: 'my-archive', key: 'sub/file.txt' }
 *   'file.txt'                → { bucket: 'default',    key: 'file.txt' }
 *
 * A bare, slash-less path therefore has no dedicated bucket-operation meaning —
 * it is always an object in the 'default' bucket. Bucket-level endpoints
 * (CreateBucket / DeleteBucket / HeadBucket) are intentionally unimplemented for
 * this reason; see the decision note in http.ts. S3 clients must set
 * `no_check_bucket = true` so they never emit those calls.
 */
const parseBucketAndKey = (rawKey: string): { bucket: string; key: string } => {
  const slashIndex = rawKey.indexOf('/')
  if (slashIndex === -1) {
    return { bucket: 'default', key: rawKey }
  }
  return {
    bucket: rawKey.slice(0, slashIndex),
    key: rawKey.slice(slashIndex + 1),
  }
}

const getUploadOptions = (req: Request) => {
  const {
    'x-amz-meta-compression': compressionAlgorithm,
    'x-amz-meta-encryption': encryptionAlgorithm,
  } = req.headers

  const UploadOptions: UploadOptions = {
    compression: compressionAlgorithm
      ? { algorithm: compressionAlgorithm as CompressionAlgorithm }
      : undefined,
    encryption: encryptionAlgorithm
      ? { algorithm: encryptionAlgorithm as EncryptionAlgorithm }
      : undefined,
  }

  return UploadOptions
}

/**
 * The modification time a client associates with an object, sent as the
 * x-amz-meta-mtime header (rclone uses a float unix-seconds string). Stored and
 * echoed back verbatim so the value round-trips with full precision.
 */
const getMtime = (req: Request): string | null => {
  const mtime = req.headers['x-amz-meta-mtime']
  return typeof mtime === 'string' ? mtime : null
}

/**
 * The versionId query param on a GET/HEAD/DELETE request. versionId is the
 * content CID of a specific version; absent/empty means "the current version".
 */
const getVersionId = (req: Request): string | undefined => {
  const versionId = req.query.versionId
  return typeof versionId === 'string' && versionId.length > 0
    ? versionId
    : undefined
}

// x-amz-meta-* keys that are NOT free-form user metadata: they are handled by
// dedicated paths and must be excluded from the captured userMetadata so they
// are not double-stored / double-emitted. mtime has its own column; compression
// and encryption drive the upload options (and round-trip via the IPLD flags);
// cid is a response-only header the server sets.
const RESERVED_META_KEYS = new Set(['mtime', 'compression', 'encryption', 'cid'])

const headerString = (
  value: string | string[] | undefined,
): string | undefined => (typeof value === 'string' ? value : undefined)

// A client-declared Content-Encoding for a body-storing op (PutObject/
// UploadPart) is stashed here by the S3 router's pre-parser middleware (see
// http.ts) once it has hidden the header from Express's parser, so the object
// bytes are stored verbatim — S3 never inflates a stored body; Content-Encoding
// is opaque metadata. It is deliberately kept OFF req.headers, in a
// request-scoped WeakMap keyed by the Request, so a client cannot forge it over
// the wire: HTTP callers set headers, not this server-side side channel.
// Entries are garbage-collected with the request.
const stashedContentEncoding = new WeakMap<Request, string>()

/**
 * Stash a body-storing op's client Content-Encoding for later metadata capture
 * (getObjectMetadata). Called only by the S3 router's pre-parser middleware; the
 * value is thus never read from a client-controllable channel.
 */
export const stashContentEncoding = (req: Request, encoding: string): void => {
  stashedContentEncoding.set(req, encoding)
}

/**
 * Capture the standard S3 object metadata a write request carries: the system
 * headers (Content-Type, Cache-Control, Content-Language, Content-Disposition,
 * Content-Encoding) and arbitrary user metadata (x-amz-meta-*, minus the
 * reserved keys above). Returns null when the request carried no metadata at all
 * so the stored column stays NULL for such objects.
 */
const getObjectMetadata = (req: Request): S3ObjectMetadata | null => {
  const metadata: S3ObjectMetadata = {}

  const contentType = headerString(req.headers['content-type'])
  if (contentType) metadata.contentType = contentType
  const cacheControl = headerString(req.headers['cache-control'])
  if (cacheControl) metadata.cacheControl = cacheControl
  const contentLanguage = headerString(req.headers['content-language'])
  if (contentLanguage) metadata.contentLanguage = contentLanguage
  const contentDisposition = headerString(req.headers['content-disposition'])
  if (contentDisposition) metadata.contentDisposition = contentDisposition
  // The pre-parser middleware (http.ts) moves a client Content-Encoding off the
  // headers onto a request-scoped side channel for EVERY write op that carries
  // it — PutObject/UploadPart (body stored verbatim) and CreateMultipartUpload/
  // CopyObject (empty body the parser would 415/400 on before this ran) — so
  // read it back from there. It cannot be forged: a client-sent header only ever
  // lands in req.headers, never in the WeakMap. The req.headers fallback just
  // catches an 'identity' encoding the middleware intentionally leaves in place.
  // The aws-chunked token is dropped, and only that token: it is AWS transfer
  // framing (the middleware leaves it on the headers for exactly that reason),
  // never a description of the stored bytes, so echoing it back as the object's
  // Content-Encoding would advertise an encoding untied to the body. A composite
  // 'aws-chunked,gzip' keeps its gzip — discarding the whole value would lose
  // the client's real encoding along with the framing.
  const rawContentEncoding =
    headerString(req.headers['content-encoding']) ??
    stashedContentEncoding.get(req)
  const contentEncoding = rawContentEncoding
    ?.split(',')
    .map((token) => token.trim())
    .filter((token) => token.toLowerCase() !== 'aws-chunked')
    .join(', ')
  if (contentEncoding) metadata.contentEncoding = contentEncoding

  const userMetadata: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    // Node lowercases header names, so a direct prefix check is sufficient.
    const key = name.startsWith('x-amz-meta-')
      ? name.slice('x-amz-meta-'.length)
      : null
    if (!key || RESERVED_META_KEYS.has(key)) continue
    const v = headerString(value)
    if (v !== undefined) userMetadata[key] = v
  }
  if (Object.keys(userMetadata).length > 0) metadata.userMetadata = userMetadata

  return Object.keys(metadata).length > 0 ? metadata : null
}

// Real S3 caps user-defined metadata (the x-amz-meta-* entries) at 2 KB — the
// sum of the UTF-8 byte lengths of every key and value — and rejects a larger
// write with 400 MetadataTooLarge. System headers (Content-Type, Cache-Control,
// …) do NOT count toward it. We enforce the same bound: it matches client/SDK
// expectations (SDKs already handle this error) and keeps the stored metadata —
// persisted as jsonb and replayed on every GET/HEAD — bounded.
const MAX_USER_METADATA_BYTES = 2048

/** Sum of the UTF-8 byte lengths of the user-metadata keys and values (the S3
 *  measure for the 2 KB limit). System headers are excluded — only x-amz-meta-*
 *  captured into userMetadata is counted. */
export const userMetadataByteSize = (
  metadata: S3ObjectMetadata | null | undefined,
): number => {
  if (!metadata?.userMetadata) return 0
  let total = 0
  for (const [key, value] of Object.entries(metadata.userMetadata)) {
    total += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8')
  }
  return total
}

/**
 * Guard the S3 2 KB user-metadata limit on a write. When exceeded, sends a 400
 * MetadataTooLarge (S3's error, which SDKs recognise) and returns true so the
 * caller bails before doing any upload work; returns false (nothing sent) when
 * within the limit. Shared by every write that captures request metadata
 * (PutObject, CreateMultipartUpload, CopyObject REPLACE) so none can bypass it.
 */
const rejectIfUserMetadataTooLarge = (
  res: Response,
  metadata: S3ObjectMetadata | null | undefined,
): boolean => {
  if (userMetadataByteSize(metadata) <= MAX_USER_METADATA_BYTES) return false
  sendXML(res.status(400), 'Error', {
    Code: 'MetadataTooLarge',
    Message: 'Your metadata headers exceed the maximum allowed metadata size.',
  })
  return true
}

/**
 * The S3 error Code to report for a given HTTP status.
 *
 * Keyed on status rather than on error class so an HttpError added anywhere in
 * the core still lands on a sensible code instead of silently becoming a 500.
 * PaymentRequired and UnavailableForLegalReasons have no S3 equivalent — they
 * describe Auto Drive's credit and moderation rules — so they keep an honest
 * non-standard code rather than being flattened into AccessDenied. 404 is absent
 * on purpose: what was not found depends on the operation, so its code is the
 * caller's to name.
 */
const S3_ERROR_CODE_BY_STATUS: Record<number, string> = {
  400: 'InvalidRequest',
  402: 'PaymentRequired',
  403: 'AccessDenied',
  406: 'InvalidRequest',
  409: 'OperationAborted',
  410: 'NoSuchKey',
  413: 'EntityTooLarge',
  415: 'InvalidRequest',
  451: 'UnavailableForLegalReasons',
  501: 'NotImplemented',
  503: 'ServiceUnavailable',
}

/**
 * Answer a failed S3 operation in the S3 protocol: an <Error> document carrying
 * an S3 Code, at the error's own status.
 *
 * Not the shared handleError, which renders JSON. An S3 SDK cannot map a JSON
 * body to a typed error, so the client sees only an opaque failure — the same
 * problem a rejected API key had before it was answered as 403
 * InvalidAccessKeyId, and the reason every other error on this controller is
 * already written as XML by hand.
 *
 * notFoundCode names what was missing, since 404 covers two different things
 * here: an object key (NoSuchKey) and a multipart upload id (NoSuchUpload).
 */
const handleS3Error = (
  error: Error,
  res: Response,
  notFoundCode: 'NoSuchKey' | 'NoSuchUpload' = 'NoSuchKey',
) => {
  const status = error instanceof HttpError ? error.statusCode : 500
  const code =
    status === 404
      ? notFoundCode
      : (S3_ERROR_CODE_BY_STATUS[status] ?? 'InternalError')
  if (status >= 500) {
    // A 5xx message is a fixed string: an unexpected error's own message can
    // carry a pg detail, a path, or an internal id, and the shared handleError
    // this replaced masked exactly that. The detail belongs in the log.
    logger.error(error, 'S3 request failed')
    sendXML(res.status(status), 'Error', {
      Code: code,
      Message: 'We encountered an internal error. Please try again.',
    })
    return
  }
  sendXML(res.status(status), 'Error', { Code: code, Message: error.message })
}

/**
 * A single byte-range request, as written by the client.
 *
 * 'offset' is `bytes=<start>-<end?>`; 'suffix' is `bytes=-<length>`, the LAST
 * `length` bytes, which cannot be turned into offsets until the object's size is
 * known.
 */
export type S3RangeSpec =
  | { kind: 'offset'; start: number; end?: number }
  | { kind: 'suffix'; length: number }

// The separator is '=' per RFC 7233. A single space is also accepted because the
// parser this replaces read the header by slicing six characters ('bytes '), so
// `bytes 0-9` has always worked here; tightening it would change behaviour for
// any caller relying on that rather than fix a defect.
const SINGLE_BYTE_RANGE = /^bytes[= ](\d*)-(\d*)$/i

/**
 * Parse a Range header strictly, and IGNORE anything that isn't one satisfiable
 * shape — which is what RFC 7233 requires of a malformed Range and what S3 does
 * with a multi-range request: serve the whole object.
 *
 * Not the shared getByteRange: it runs Number() over whatever sits either side
 * of the first '-' with no NaN guard, so `bytes=0-9, 20-29` (a real client
 * shape) parses to [0, NaN] and `bytes=-500` — the last 500 bytes — parses to
 * [0, 500], i.e. the FIRST 501. Both then flow into Content-Range and
 * Content-Length: the first advertises `bytes 0-NaN/70` with a NaN length, the
 * second hands a trailer reader the head of the file and calls it the trailer.
 * Suffix ranges are how Parquet, ORC, ZIP and media clients read footers, so
 * getting them wrong is silent, plausible, wrong data.
 */
export const parseS3Range = (req: Request): S3RangeSpec | undefined => {
  const header = req.headers['range']
  if (typeof header !== 'string') return undefined

  const match = SINGLE_BYTE_RANGE.exec(header.trim())
  if (!match) return undefined
  const [, rawStart, rawEnd] = match

  // `bytes=-N`: the last N bytes. `bytes=-` matches neither form.
  if (rawStart === '') {
    if (rawEnd === '') return undefined
    return { kind: 'suffix', length: Number(rawEnd) }
  }

  const start = Number(rawStart)
  if (rawEnd === '') return { kind: 'offset', start }

  const end = Number(rawEnd)
  // An inverted range is not satisfiable and not a valid Range: ignore it rather
  // than answer 416, per RFC 7233.
  if (end < start) return undefined
  return { kind: 'offset', start, end }
}

/**
 * Turn a suffix range into absolute offsets now that the size is known, or
 * report that no such range exists.
 */
export const resolveSuffixRange = (
  length: number,
  size: bigint,
): ByteRange | 'unsatisfiable' => {
  const total = Number(size)
  // Zero bytes of a suffix, or any suffix of an empty object, names nothing.
  if (length === 0 || total === 0) return 'unsatisfiable'
  return [Math.max(0, total - length), total - 1]
}

/**
 * Refuse a Range the object cannot satisfy, the way S3 does: 416 InvalidRange
 * with a `Content-Range: bytes * /<size>` telling the client the real size.
 *
 * The download use case clamps only the range's END against the object size
 * (getCalculatedResultingByteRange), so a start past the last byte survives as
 * an inverted range — `bytes 100-69/70` with a Content-Length of -30, and a body
 * that cannot match it. Checking the start here is what keeps every downstream
 * range calculation (this file's and the shared helper's) working on a range
 * that is known to fit.
 *
 * A missing stored size is refused for the same reason: with no size, no range
 * can be honestly described, and answering with an unlabelled partial body would
 * let the client read a slice as the whole object.
 *
 * Returns true once a response has been sent.
 */
const sendRangeNotSatisfiable = (
  req: Request,
  res: Response,
  size: bigint | undefined,
) => {
  res.setHeader('Content-Range', `bytes */${size ?? 0}`)
  sendXML(res.status(416), 'Error', {
    Code: 'InvalidRange',
    Message: 'The requested range is not satisfiable',
    RangeRequested: req.headers['range'] ?? '',
    ActualObjectSize: (size ?? BigInt(0)).toString(),
  })
}

const rejectIfRangeNotSatisfiable = (
  req: Request,
  res: Response,
  byteRange: ByteRange | undefined,
  size: bigint | undefined,
): boolean => {
  if (!byteRange) return false
  if (size != null && byteRange[0] < Number(size)) return false

  sendRangeNotSatisfiable(req, res, size)
  return true
}

/**
 * The absolute offsets a download is prepared with, plus the version they were
 * computed against when that took a separate read.
 */
type ResolvedRange = {
  byteRange: ByteRange | undefined
  /**
   * Set only for a resolved suffix range: the versionId (CID) of the object the
   * size was measured on, which the body then has to be read from.
   */
  versionId?: string
}

/**
 * Resolve the request's Range into the absolute offsets the download is prepared
 * with.
 *
 * An 'offset' range needs nothing up front: the size only arrives with the
 * download, and rejectIfRangeNotSatisfiable checks the start against it before a
 * single header is written. A 'suffix' range does need it — `bytes=-500` names
 * nothing until the size is known, yet the range has to be baked into the
 * download options before the download is prepared. So it costs one extra
 * metadata read (no bytes are fetched until startDownload()), confined to the
 * requests that actually need it.
 *
 * Returns the range to read with, or null once a response has been sent.
 */
const resolveRequestedRange = async (
  req: Request,
  res: Response,
  user: UserWithOrganization,
  target: { Bucket: string; Key: string; VersionId?: string },
  spec: S3RangeSpec | undefined,
): Promise<ResolvedRange | null> => {
  if (spec === undefined) return { byteRange: undefined }
  if (spec.kind === 'offset') {
    // An open-ended range keeps its undefined end: the download use case clamps
    // it to the last byte once it knows the size.
    return { byteRange: [spec.start, spec.end] }
  }

  const probe = await S3UseCases.getObject(user, target)
  if (probe.isErr()) {
    handleS3Error(probe.error, res)
    return null
  }

  const size = probe.value.metadata.size
  const resolved =
    size == null ? 'unsatisfiable' : resolveSuffixRange(spec.length, size)
  if (resolved === 'unsatisfiable') {
    sendRangeNotSatisfiable(req, res, size)
    return null
  }
  // Pin the body to the version the size was just measured on. Without it the
  // offsets derived from THIS size are replayed against whatever bucket/key
  // resolves to on the second lookup, and a PutObject landing in between makes
  // that a different object: the client gets a 206 for "the last N bytes" that
  // is a slice sized for the old content, cut out of the new one, carrying the
  // new ETag and x-amz-version-id beside it — a torn read that looks coherent.
  // The pin always resolves: createMapping appends the version row in the same
  // statement that advances the current-version pointer, and the table was
  // backfilled for every mapping that predates it.
  return { byteRange: resolved, versionId: probe.value.cid }
}

/**
 * Emit stored S3 object metadata on a GET/HEAD response verbatim, overriding the
 * generic values the shared download-header helper computed. Uses res.setHeader
 * (Node) rather than res.set (Express) so Content-Type is sent byte-for-byte with
 * no injected "; charset=..." — S3 never mutates a stored Content-Type.
 */
const applyStoredMetadataHeaders = (
  res: Response,
  metadata: S3ObjectMetadata | null,
) => {
  if (!metadata) return
  if (metadata.contentType) res.setHeader('Content-Type', metadata.contentType)
  if (metadata.cacheControl)
    res.setHeader('Cache-Control', metadata.cacheControl)
  if (metadata.contentLanguage)
    res.setHeader('Content-Language', metadata.contentLanguage)
  if (metadata.contentDisposition)
    res.setHeader('Content-Disposition', metadata.contentDisposition)
  // The stored Content-Encoding is always echoed. Nothing else on this path may
  // set the header: applyVerbatimBodyHeaders strips the `deflate` the shared
  // download helper adds for internally-compressed objects, so the client's own
  // value is the only encoding the response can ever advertise, and it describes
  // the bytes actually sent.
  if (metadata.contentEncoding)
    res.setHeader('Content-Encoding', metadata.contentEncoding)
  if (metadata.userMetadata) {
    for (const [key, value] of Object.entries(metadata.userMetadata)) {
      res.setHeader(`x-amz-meta-${key}`, value)
    }
  }
}

/**
 * Re-assert the one invariant of the S3 read path: the response body is the
 * STORED bytes, verbatim.
 *
 * handleDownloadResponseHeaders is written for the browser-facing download API,
 * where an internally-compressed object (x-amz-meta-compression) is either
 * shipped as `Content-Encoding: deflate` for the browser to inflate, or inflated
 * server-side. Neither describes S3: this layer pipes what
 * `startDownload()` yields straight to the wire, the stored MD5 (the ETag) is
 * over those same bytes, and metadata.size counts them.
 *
 * Left uncorrected, that helper's compressed branch produces four defects on an
 * internally-compressed object, none of them true of the body being sent:
 *  - `Content-Encoding: deflate`, an encoding the client never stored. Any hop
 *    or client that honours it inflates the body, and the bytes delivered then
 *    no longer match the ETag. (This is the origin-side twin of the Cloudflare
 *    transform in #814 — the same corruption, triggered by our own header.)
 *  - no Content-Length, so HeadObject reports no size and rclone's size check
 *    fails.
 *  - `Accept-Ranges: none`, so ranged reads are refused.
 *  - worst: a range request is answered 200 with no Content-Range while the body
 *    IS the requested slice, so the client reads a partial object as the whole
 *    one.
 *
 * Only the compressed branch is repaired here; on every other object the helper
 * already computes exactly these values. Must run BEFORE
 * applyStoredMetadataHeaders, which re-emits the client's own stored
 * Content-Encoding after this strips the synthesised one.
 */
export const applyVerbatimBodyHeaders = (
  res: Response,
  metadata: DownloadMetadata,
  byteRange: ByteRange | undefined,
) => {
  if (metadata.type !== 'file' || !metadata.isCompressed) return

  // The wire body is never re-encoded, so no transfer encoding is ours to claim.
  res.removeHeader('Content-Encoding')

  if (metadata.size == null) {
    // Unknown stored size: nothing to advertise, so rely on chunked encoding and
    // don't offer ranges. A ranged request never reaches here —
    // rejectIfRangeNotSatisfiable has already answered it 416.
    res.setHeader('Accept-Ranges', 'none')
    return
  }

  res.setHeader('Accept-Ranges', 'bytes')
  if (byteRange) {
    const upperBound = byteRange[1] ?? Number(metadata.size) - 1
    res.status(206)
    res.setHeader(
      'Content-Range',
      `bytes ${byteRange[0]}-${upperBound}/${metadata.size}`,
    )
    res.setHeader('Content-Length', (upperBound - byteRange[0] + 1).toString())
  } else {
    res.setHeader('Content-Length', metadata.size.toString())
  }
}

/**
 * Parse the source object of a CopyObject request from its x-amz-copy-source
 * header. The value is "/{bucket}/{key}" (the leading slash is optional), with
 * each path segment URL-encoded and an optional "?versionId=..." suffix. Returns
 * null when the header is missing or malformed.
 *
 * A source `?versionId=` is intentionally NOT honoured: a copy always duplicates
 * the source key's CURRENT version (and stacks a new version on the destination).
 * Copying a specific historical source version is out of scope — versionId is the
 * content CID, so a client that needs an exact version can address it another
 * way. The suffix is stripped (not rejected) so routine clients that append the
 * current versionId still copy successfully.
 */
const parseCopySource = (
  req: Request,
): { bucket: string; key: string } | null => {
  const raw = req.headers['x-amz-copy-source']
  if (typeof raw !== 'string' || raw.length === 0) return null

  // Strip any ?versionId= suffix (a specific source version is not honoured — the
  // current version is copied, see above), strip a leading slash, then URL-decode.
  const withoutVersion = raw.split('?')[0].replace(/^\//, '')
  let decoded: string
  try {
    decoded = decodeURIComponent(withoutVersion)
  } catch {
    // Malformed percent-encoding — treat as no valid source.
    return null
  }
  if (decoded.length === 0) return null

  return parseBucketAndKey(decoded)
}

/**
 * Build the absolute, host-aware object URL for the CompleteMultipartUpload
 * `Location` response field — per the S3 spec, the URL of the newly created
 * object as seen from the endpoint the client used.
 *
 * The backend mounts the S3 API at `/s3`, but the public-facing endpoint
 * differs per vhost (the dedicated `s3.` subdomain serves it at the root; the
 * legacy host serves it under `/s3`) and nginx rewrites both onto `/s3` before
 * the request reaches here. So the URL is reconstructed from the forwarding
 * headers nginx sets rather than from the request's own (rewritten) path:
 *   - X-Forwarded-Proto — scheme at the edge (nginx terminates TLS and proxies
 *     over http, so req.protocol alone would always read 'http').
 *   - Host — the public hostname (forwarded via `proxy_set_header Host`).
 *   - X-Forwarded-Prefix — the public path prefix the S3 API is exposed under:
 *     '/s3' on the legacy host, root on the subdomain. nginx drops
 *     empty-valued headers, so the subdomain sends '/', normalized here to ''.
 * With no forwarding headers (requests straight to Express, e.g. tests), this
 * falls back to req.protocol, the Host header, and the '/s3' mount.
 */
const buildObjectLocation = (
  req: Request,
  bucket: string,
  key: string,
): string => {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol
  const host = req.headers.host ?? ''
  const rawPrefix = (req.headers['x-forwarded-prefix'] as string) ?? '/s3'
  const prefix = rawPrefix === '/' ? '' : rawPrefix.replace(/\/+$/, '')
  return `${proto}://${host}${prefix}/${bucket}/${key}`
}

// The inclusive part-number range S3 defines for a multipart upload.
const MIN_PART_NUMBER = 1
const MAX_PART_NUMBER = 10_000

/** Thrown when a CompleteMultipartUpload body is not valid per the S3 spec. */
export class MalformedMultipartError extends Error {}

// processEntities (on by default) decodes the &#34; that aws-sdk-go-v2 (rclone)
// uses for the ETag quotes — the crux of the fix; boto3 emits literal quotes
// and both land on `"<hex>"`. removeNSPrefix handles <s3:Part>; parseTagValue
// off keeps ETags as strings.
const multipartXmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

// Extract the part list from a CompleteMultipartUpload body. A real parser
// (not a regex) so namespaces, ordering, and entity encoding work across
// clients. Each <Part> needs an integer PartNumber (>= 1) and a non-empty
// ETag, else throws MalformedMultipartError so the caller can return 400
// MalformedXML. Returns parts sorted by PartNumber.
export const parseMultipartParts = (
  body: Buffer,
): Array<{ PartNumber: number; ETag: string }> => {
  let parsed: unknown
  try {
    parsed = multipartXmlParser.parse(body.toString('utf-8'))
  } catch {
    throw new MalformedMultipartError('Malformed CompleteMultipartUpload XML')
  }

  const root = (parsed as Record<string, unknown> | undefined)
    ?.CompleteMultipartUpload as Record<string, unknown> | undefined
  if (root == null || typeof root !== 'object') {
    throw new MalformedMultipartError(
      'Missing CompleteMultipartUpload root element',
    )
  }

  // <Part> is a single object for one part and an array for many.
  const rawPart = root.Part
  const rawParts =
    rawPart == null ? [] : Array.isArray(rawPart) ? rawPart : [rawPart]
  if (rawParts.length === 0) {
    throw new MalformedMultipartError('CompleteMultipartUpload has no parts')
  }

  const parts = rawParts.map((part) => {
    const record = part as Record<string, unknown>
    const partNumber = Number(record?.PartNumber)
    const etag = record?.ETag
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      throw new MalformedMultipartError('Part is missing a valid PartNumber')
    }
    if (typeof etag !== 'string' || etag.trim() === '') {
      throw new MalformedMultipartError('Part is missing a non-empty ETag')
    }
    return { PartNumber: partNumber, ETag: etag.trim() }
  })

  return parts.sort((a, b) => a.PartNumber - b.PartNumber)
}

export const listBucketsHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const buckets = await S3UseCases.listBuckets(user)
  sendXML(res, 'ListAllMyBucketsResult', {
    Buckets: {
      Bucket: buckets.map((b) => ({
        Name: b.name,
        CreationDate: b.creationDate.toISOString(),
      })),
    },
  })
}

export const getObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)
  const target = {
    Key: key,
    Bucket: bucket,
    VersionId: getVersionId(req),
  }
  const resolvedRange = await resolveRequestedRange(
    req,
    res,
    user,
    target,
    parseS3Range(req),
  )
  if (!resolvedRange) return
  const { byteRange, versionId } = resolvedRange

  const downloadResult = await S3UseCases.getObject(user, {
    ...target,
    // versionId is set only by a resolved suffix range, and then it IS the
    // version this request already committed to; otherwise the client's own
    // ?versionId (or the current version) stands.
    VersionId: versionId ?? target.VersionId,
    Range: byteRange,
  })

  if (downloadResult.isErr()) {
    handleS3Error(downloadResult.error, res)
    return
  }
  const {
    metadata,
    startDownload,
    byteRange: resultingByteRange,
    cid,
    etag,
    lastModified,
    mtime,
    objectMetadata,
  } = downloadResult.value

  if (rejectIfRangeNotSatisfiable(req, res, byteRange, metadata.size)) return

  // The helper's shouldDecompressBody is deliberately unused: it asks the caller
  // to inflate an internally-compressed body, which is right for the
  // browser-facing download API and wrong here — S3 returns the stored bytes,
  // and the ETag is their MD5. applyVerbatimBodyHeaders below re-describes the
  // response accordingly.
  handleDownloadResponseHeaders(req, res, metadata, {
    byteRange: resultingByteRange,
  })
  handleS3DownloadResponseHeaders(req, res, metadata)
  applyVerbatimBodyHeaders(res, metadata, resultingByteRange)
  // Override the generic headers with the stored S3 metadata (verbatim
  // Content-Type, Cache-Control, x-amz-meta-*, …) — must run after the helpers
  // above so it wins.
  applyStoredMetadataHeaders(res, objectMetadata)

  // ETag: set to the MD5 for objects uploaded after this feature was introduced.
  // Legacy objects (md5 = null in the DB) do not get an ETag header — the CID
  // is always available in x-amz-meta-cid for Autonomys-aware clients.
  if (etag) res.set('ETag', etag)
  // Always expose the CID so clients that understand Autonomys can use it.
  res.set('x-amz-meta-cid', cid)
  // versionId = the content CID (versioning is always on).
  res.set('x-amz-version-id', cid)
  res.set('Last-Modified', lastModified.toUTCString())
  // Echo the client mtime so tools (e.g. rclone) read back what they wrote.
  if (mtime) res.set('x-amz-meta-mtime', mtime)

  pipeline(await startDownload(), res, (err: Error | null) => {
    if (err) {
      if (res.headersSent) return
      logger.error(err, 'Error streaming an S3 object body')
      // XML, and no err.message: the same reasons as handleS3Error — an SDK
      // cannot type a JSON body, and the message is a DSN/gateway internal.
      sendXML(res.status(500), 'Error', {
        Code: 'InternalError',
        Message: 'We encountered an internal error. Please try again.',
      })
    }
  })
}

export const headObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)
  const target = {
    Key: key,
    Bucket: bucket,
    VersionId: getVersionId(req),
  }
  const resolvedRange = await resolveRequestedRange(
    req,
    res,
    user,
    target,
    parseS3Range(req),
  )
  if (!resolvedRange) return
  const { byteRange, versionId } = resolvedRange

  const downloadResult = await S3UseCases.getObject(user, {
    ...target,
    // versionId is set only by a resolved suffix range, and then it IS the
    // version this request already committed to; otherwise the client's own
    // ?versionId (or the current version) stands.
    VersionId: versionId ?? target.VersionId,
    Range: byteRange,
  })

  if (downloadResult.isErr()) {
    handleS3Error(downloadResult.error, res)
    return
  }
  const {
    metadata,
    byteRange: resultingByteRange,
    cid,
    etag,
    lastModified,
    mtime,
    objectMetadata,
  } = downloadResult.value

  if (rejectIfRangeNotSatisfiable(req, res, byteRange, metadata.size)) return

  // The helper's shouldDecompressBody is deliberately unused: it asks the caller
  // to inflate an internally-compressed body, which is right for the
  // browser-facing download API and wrong here — S3 returns the stored bytes,
  // and the ETag is their MD5. applyVerbatimBodyHeaders below re-describes the
  // response accordingly.
  handleDownloadResponseHeaders(req, res, metadata, {
    byteRange: resultingByteRange,
  })
  handleS3DownloadResponseHeaders(req, res, metadata)
  applyVerbatimBodyHeaders(res, metadata, resultingByteRange)
  // Override the generic headers with the stored S3 metadata (verbatim
  // Content-Type, Cache-Control, x-amz-meta-*, …) — must run after the helpers
  // above so it wins.
  applyStoredMetadataHeaders(res, objectMetadata)

  // ETag: set to the MD5 for objects uploaded after this feature was introduced.
  // Legacy objects (md5 = null in the DB) do not get an ETag header — the CID
  // is always available in x-amz-meta-cid for Autonomys-aware clients.
  if (etag) res.set('ETag', etag)
  // Always expose the CID so clients that understand Autonomys can use it.
  res.set('x-amz-meta-cid', cid)
  // versionId = the content CID (versioning is always on).
  res.set('x-amz-version-id', cid)
  res.set('Last-Modified', lastModified.toUTCString())
  // Echo the client mtime so tools (e.g. rclone) read back what they wrote.
  if (mtime) res.set('x-amz-meta-mtime', mtime)

  // end() without a status: HeadObject returns the headers GET would send
  // (Content-Length, Content-Type, …) with an empty body, and Express's default
  // 200 is already that. Setting 200 explicitly used to overwrite the 206 a
  // ranged HEAD had just set, so the reply came back "whole object" while
  // carrying a range-sized Content-Length. (Never 204 — that status is defined
  // as bodiless, so Node strips the content headers this response exists for.)
  res.end()
}

// ── Versioning + Object Lock (honest WORM) ─────────────────────────────────
// Auto Drive stores content on the Autonomys DSN, where a version can never be
// destroyed. That is exactly S3's versioned-WORM model: versioning is always on,
// every write stacks a new version (versionId = CID), DeleteObject writes a
// delete marker (the key is hidden but nothing is destroyed), and destroying a
// specific version (DeleteObject?versionId) is refused — here not by policy but
// because the platform is incapable of it. Storage is permanent: data on the
// DSN is never destroyed. S3's bucket DefaultRetention must be a finite DURATION
// (Days/Years), not "forever", so we advertise a COMPLIANCE-mode Object Lock
// with a 100-year window — the conventional S3 maximum, our stand-in for
// "permanent". The lock is intrinsic and not client-configurable, so the Put*
// counterparts stay 501. Legal hold is a separate, per-object client-set concept
// Auto Drive has no equivalent for, so it stays OFF.

// The COMPLIANCE retention window. BOTH the bucket-level DefaultRetention (a
// duration, in Years) and each object's RetainUntilDate (a date = write time +
// this many years) derive from this one value, so the two can never disagree.
// Kept at a finite 100y rather than a far-future "forever" date: it stays well
// under the year-9999 ceiling that overflows common clients (e.g. boto3's
// datetime.max) while still meaning "effectively permanent" for any real object.
const OBJECT_LOCK_RETENTION_YEARS = 100

export const bucketVersioningBody = () => ({ Status: 'Enabled' })

export const objectLockConfigurationBody = () => ({
  ObjectLockEnabled: 'Enabled',
  Rule: {
    DefaultRetention: { Mode: 'COMPLIANCE', Years: OBJECT_LOCK_RETENTION_YEARS },
  },
})

// Per-object retention: COMPLIANCE until the object's write time + the default
// window — exactly what the bucket's Years default yields, so the bucket rule
// and the per-object date always agree. (They were inconsistent before: a
// 100-year bucket default vs. a year-9999 per-object date.)
export const objectRetentionBody = (writeTime: Date) => {
  const retainUntil = new Date(writeTime)
  retainUntil.setUTCFullYear(
    retainUntil.getUTCFullYear() + OBJECT_LOCK_RETENTION_YEARS,
  )
  return {
    Mode: 'COMPLIANCE',
    RetainUntilDate: retainUntil.toISOString(),
  }
}

/** No per-object legal hold concept (distinct from the intrinsic retention). */
export const objectLegalHoldBody = () => ({ Status: 'OFF' })

// GetBucketVersioning — versioning is always on, by construction; there is no
// client toggle (PutBucketVersioning stays unrouted → 501).
export const getBucketVersioningHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return
  sendXML(res, 'VersioningConfiguration', bucketVersioningBody())
}

export const getObjectLockConfigurationHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return
  sendXML(res, 'ObjectLockConfiguration', objectLockConfigurationBody())
}

// Reject a key that doesn't exist with NoSuchKey rather than reporting lock
// state for a nonexistent object.
const sendNoSuchKey = (res: Response, key: string) => {
  sendXML(res.status(404), 'Error', {
    Code: 'NoSuchKey',
    Message: 'The specified key does not exist.',
    Key: key,
  })
}

export const getObjectRetentionHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return
  const { bucket, key } = parseBucketAndKey(req.params.key)
  const writeTime = await S3UseCases.getObjectWriteTime(user, bucket, key)
  if (!writeTime) {
    sendNoSuchKey(res, key)
    return
  }
  // COMPLIANCE retention anchored to this object's write time (write + window).
  sendXML(res, 'Retention', objectRetentionBody(writeTime))
}

export const getObjectLegalHoldHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return
  const { bucket, key } = parseBucketAndKey(req.params.key)
  if (!(await S3UseCases.objectExists(user, bucket, key))) {
    sendNoSuchKey(res, key)
    return
  }
  sendXML(res, 'LegalHold', objectLegalHoldBody())
}

export const createMultipartUploadHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const uploadOptions = getUploadOptions(req)
  const { bucket, key } = parseBucketAndKey(req.params.key)

  const metadata = getObjectMetadata(req)
  if (rejectIfUserMetadataTooLarge(res, metadata)) return

  const result = await S3UseCases.createMultipartUpload(user, {
    Bucket: bucket,
    Key: key,
    ContentType: req.headers['content-type'],
    UploadOptions: uploadOptions,
    Mtime: getMtime(req),
    Metadata: metadata,
  })

  if (result.isErr()) {
    handleS3Error(result.error, res)
    return
  }

  sendXML(res, 'CreateMultipartUploadResult', result.value)
}

export const uploadPartHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)
  const { uploadId, partNumber } = req.query

  // Validate required parameters
  if (!uploadId || !partNumber) {
    logger.error(
      'Missing required parameters: uploadId=%s, partNumber=%s',
      uploadId,
      partNumber,
    )
    sendXML(res.status(400), 'Error', {
      Code: 'InvalidArgument',
      Message: 'The uploadId and partNumber query parameters are required.',
    })
    return
  }

  // S3 part numbers are 1..10000, and the bound is load-bearing, not cosmetic:
  // uploadPart subtracts one for the 0-indexed internal part, so partNumber=0
  // becomes -1, which uploadChunk reads as "already processed" and drops. The
  // handler would then answer 200 with an ETag over bytes that were never
  // stored, and CompleteMultipartUpload would fold that ETag into the composite
  // — a complete object, by its own checksum, missing a part.
  // Number (not parseInt) so '1abc' and a repeated ?partNumber= are rejected
  // rather than truncated to something plausible.
  const parsedPartNumber = Number(partNumber)
  if (
    !Number.isInteger(parsedPartNumber) ||
    parsedPartNumber < MIN_PART_NUMBER ||
    parsedPartNumber > MAX_PART_NUMBER
  ) {
    logger.error('Invalid partNumber: %s', partNumber)
    sendXML(res.status(400), 'Error', {
      Code: 'InvalidArgument',
      Message: `The partNumber query parameter must be an integer between ${MIN_PART_NUMBER} and ${MAX_PART_NUMBER}.`,
      ArgumentName: 'partNumber',
      ArgumentValue: String(partNumber),
    })
    return
  }

  logger.info('Uploading part %s of %s', parsedPartNumber, uploadId)

  const result = await S3UseCases.uploadPart(user, {
    Bucket: bucket,
    Key: key,
    UploadId: uploadId as string,
    PartNumber: parsedPartNumber,
    Body: req.body,
  })

  if (result.isErr()) {
    handleS3Error(result.error, res, 'NoSuchUpload')
    return
  }

  // The AWS SDK reads the part ETag exclusively from the HTTP ETag header.
  // Respond with the header only — no body — so Express's auto-ETag
  // generation cannot overwrite our MD5 value with a body-derived hash.
  res.set('ETag', result.value.ETag)
  res.status(200).end()
}

export const completeMultipartUploadHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)

  // Parse the part list from the XML request body so we can compute the
  // standard S3 composite ETag (MD5 of concatenated per-part MD5s + part count).
  // A body that can't be parsed into valid parts is a client error, not a
  // reason to silently store a wrong ETag — reject it with 400 MalformedXML.
  let parts: Array<{ PartNumber: number; ETag: string }>
  try {
    parts = parseMultipartParts(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))
  } catch (error) {
    if (error instanceof MalformedMultipartError) {
      sendXML(res.status(400), 'Error', {
        Code: 'MalformedXML',
        Message: error.message,
      })
      return
    }
    throw error
  }

  // completeUpload throws (rather than returning an err) when it cannot take the
  // completion claim, and this handler has no error middleware behind it — an
  // uncaught throw reaches Express's default handler and answers a non-XML 500,
  // which an S3 client cannot parse and will not retry. Concurrent completes are
  // precisely what a client's own timeout retry produces, so answer with the
  // retryable error S3 clients already understand: 503 SlowDown, which the AWS
  // SDK retries with backoff until the winning call finishes.
  let result
  try {
    result = await S3UseCases.completeMultipartUpload(user, {
      Bucket: bucket,
      Key: key,
      UploadId: req.query.uploadId as string,
      Parts: parts,
    })
  } catch (error) {
    if (error instanceof UploadCompletionInProgressError) {
      logger.info(
        'Completion already in progress, answering SlowDown (uploadId=%s)',
        error.uploadId,
      )
      sendXML(res.status(503), 'Error', {
        Code: 'SlowDown',
        Message:
          'A completion for this upload is already in progress. Please retry.',
      })
      return
    }
    // The other end of the same problem: this one is terminal, so it must NOT
    // look retryable. A client that appended a part after a failed completion
    // has to abort and start again, and it can only learn that from a 4xx it can
    // parse — the same reason SlowDown is spelled out above rather than left to
    // Express's default handler.
    if (error instanceof UploadPartsChangedError) {
      logger.warn(
        'Parts changed after the root node was derived, answering InvalidRequest (uploadId=%s)',
        error.uploadId,
      )
      sendXML(res.status(400), 'Error', {
        Code: 'InvalidRequest',
        Message: error.message,
      })
      return
    }
    throw error
  }

  if (result.isErr()) {
    handleS3Error(result.error, res, 'NoSuchUpload')
    return
  }

  // Set ETag and CID headers explicitly and use res.end() rather than sendXML
  // (which calls res.send()). res.send() triggers Express's auto-ETag generation
  // which would overwrite our composite MD5 ETag with a body-derived hash.
  const { Cid: completeCid, ETag: completeETag, ...completeXmlBody } = result.value
  // Location is built here (not in the use case) because it depends on the
  // public endpoint the request arrived on — see buildObjectLocation.
  const Location = buildObjectLocation(req, bucket, key)
  res.set('ETag', completeETag)
  res.set('x-amz-meta-cid', completeCid)
  // versionId of the version this upload created = its content CID.
  res.set('x-amz-version-id', completeCid)
  res.setHeader('Content-Type', 'application/xml')
  res.end(
    js2xmlparser.parse('CompleteMultipartUploadResult', {
      ETag: completeETag,
      Location,
      ...completeXmlBody,
    }),
  )
}

export const listObjectsV2Handler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  // For ListObjectsV2, req.params.key is purely a bucket name.  The AWS SDK
  // appends a trailing slash when using bucketEndpoint:true, so we get either
  // "my-bucket/" or "my-bucket" — take everything before the first '/'.
  const bucket = req.params.key.split('/')[0]

  const prefix = (req.query.prefix as string) ?? ''
  const delimiter = (req.query.delimiter as string) ?? null
  const rawMaxKeys = parseInt((req.query['max-keys'] as string) ?? '1000', 10)
  const maxKeys = Math.min(Math.max(rawMaxKeys > 0 ? rawMaxKeys : 1000, 1), 1000)
  const continuationToken =
    (req.query['continuation-token'] as string) ?? null
  const encodingType = (req.query['encoding-type'] as string) ?? null

  const result = await S3UseCases.listObjects(user, {
    bucket,
    prefix,
    delimiter,
    maxKeys,
    continuationToken,
  })

  // Keys may contain characters XML cannot represent; encoding-type=url is the
  // S3 mechanism for returning them. Without opt-in, reject with 400 rather
  // than throwing a 500 in the serializer.
  const plan = planListingEncoding(
    [...result.objects.map((o) => o.key), ...result.commonPrefixes],
    encodingType,
  )

  if (plan === 'reject') {
    sendXML(res.status(400), 'Error', {
      Code: 'InvalidArgument',
      Message:
        'This listing contains keys with characters that require URL encoding. Retry the request with encoding-type=url.',
      ArgumentName: 'encoding-type',
      Resource: `/${bucket}/`,
    })
    return
  }

  const encode = plan === 'encode' ? encodeS3Key : (value: string) => value

  // Build the XML body.  js2xmlparser repeats a key for each array element,
  // which is exactly the S3 format (multiple <Contents> / <CommonPrefixes>
  // siblings at the root level).
  const xmlBody: Record<string, unknown> = {
    Name: result.name,
    Prefix: encode(result.prefix),
    MaxKeys: result.maxKeys,
    KeyCount: result.objects.length + result.commonPrefixes.length,
    IsTruncated: result.isTruncated,
  }

  // Echo the encoding back so clients know to url-decode the keys below.
  if (plan === 'encode') {
    xmlBody.EncodingType = 'url'
  }

  if (result.nextContinuationToken) {
    xmlBody.NextContinuationToken = result.nextContinuationToken
  }

  if (result.objects.length > 0) {
    xmlBody.Contents = result.objects.map((obj) => ({
      Key: encode(obj.key),
      Size: obj.size.toString(),
      LastModified: obj.lastModified.toISOString(),
      // Return the stored MD5 so clients (rclone, AWS CLI) can verify
      // checksums from the listing, matching HeadObject. Legacy objects with
      // no stored md5 fall back to the CID, which remains in x-amz-meta-cid.
      ETag: obj.md5 ? `"${obj.md5}"` : `"${obj.cid}"`,
    }))
  }

  if (result.commonPrefixes.length > 0) {
    xmlBody.CommonPrefixes = result.commonPrefixes.map((p) => ({
      Prefix: encode(p),
    }))
  }

  sendXML(res, 'ListBucketResult', xmlBody)
}

// ListObjectVersions (GET /{bucket}?versions): enumerate the version history for
// the caller's keys under a prefix, newest version first, with a synthesised
// delete marker for any key whose current pointer is soft-deleted. This is what
// exposes the versioned-WORM history — versionId is the content CID.
export const listObjectVersionsHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const bucket = req.params.key.split('/')[0]
  const prefix = (req.query.prefix as string) ?? ''
  const rawMaxKeys = parseInt((req.query['max-keys'] as string) ?? '1000', 10)
  const maxKeys = Math.min(Math.max(rawMaxKeys > 0 ? rawMaxKeys : 1000, 1), 1000)
  const keyMarker = (req.query['key-marker'] as string) ?? null
  const encodingType = (req.query['encoding-type'] as string) ?? null

  const result = await S3UseCases.getObjectVersions(user, {
    bucket,
    prefix,
    keyMarker,
    maxKeys,
  })

  // Same XML-safety contract as ListObjectsV2: keys with characters XML can't
  // represent need encoding-type=url; without opt-in, reject rather than 500.
  const plan = planListingEncoding(
    [
      ...result.versions.map((v) => v.key),
      ...result.deleteMarkers.map((m) => m.key),
    ],
    encodingType,
  )
  if (plan === 'reject') {
    sendXML(res.status(400), 'Error', {
      Code: 'InvalidArgument',
      Message:
        'This listing contains keys with characters that require URL encoding. Retry the request with encoding-type=url.',
      ArgumentName: 'encoding-type',
      Resource: `/${bucket}/`,
    })
    return
  }
  const encode = plan === 'encode' ? encodeS3Key : (value: string) => value

  const xmlBody: Record<string, unknown> = {
    Name: bucket,
    Prefix: encode(prefix),
    KeyMarker: keyMarker ?? '',
    MaxKeys: maxKeys,
    IsTruncated: result.isTruncated,
  }
  if (plan === 'encode') xmlBody.EncodingType = 'url'
  if (result.nextKeyMarker) xmlBody.NextKeyMarker = encode(result.nextKeyMarker)

  if (result.versions.length > 0) {
    xmlBody.Version = result.versions.map((v) => ({
      Key: encode(v.key),
      VersionId: v.versionId,
      IsLatest: v.isLatest,
      LastModified: v.lastModified.toISOString(),
      ETag: v.etag,
      Size: v.size.toString(),
      StorageClass: 'STANDARD',
    }))
  }
  if (result.deleteMarkers.length > 0) {
    xmlBody.DeleteMarker = result.deleteMarkers.map((m) => ({
      Key: encode(m.key),
      VersionId: m.versionId,
      IsLatest: m.isLatest,
      LastModified: m.lastModified.toISOString(),
    }))
  }

  sendXML(res, 'ListVersionsResult', xmlBody)
}

export const putObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const uploadOptions = getUploadOptions(req)
  const { bucket, key } = parseBucketAndKey(req.params.key)

  const metadata = getObjectMetadata(req)
  if (rejectIfUserMetadataTooLarge(res, metadata)) return

  const result = await S3UseCases.putObject(user, {
    Bucket: bucket,
    Key: key,
    Body: req.body,
    ContentType: req.headers['content-type'],
    UploadOptions: uploadOptions,
    Mtime: getMtime(req),
    Metadata: metadata,
  })

  if (result.isErr()) {
    handleS3Error(result.error, res)
    return
  }

  // Standard S3 PutObject: ETag and custom metadata go in response headers;
  // the body is empty.  The AWS SDK reads ETag exclusively from the header.
  const { ETag, Cid } = result.value
  res.set('ETag', ETag)
  res.set('x-amz-meta-cid', Cid)
  // versionId of the version just created = its content CID.
  res.set('x-amz-version-id', Cid)
  res.status(200).end()
}

export const deleteObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)

  // Soft-delete: the (bucket, key) mapping is hidden and, if it was the last S3
  // reference to the content, the object is moved to the owner's web-app Trash.
  // The underlying bytes are never removed from the Autonomys DSN.
  const result = await S3UseCases.deleteObject(user, bucket, key)
  if (result.isErr()) {
    handleS3Error(result.error, res)
    return
  }
  const { deleteMarker, versionId } = result.value

  // Versioning is always on: a bare DeleteObject hides the current version
  // behind a delete marker (nothing is destroyed). Surface that so a
  // versioning-aware client can tell a marker was written vs. a destructive
  // remove — matching what ListObjectVersions reports for the same delete. A
  // no-op delete (key absent/already hidden) creates no marker → bare 204.
  if (deleteMarker) {
    res.set('x-amz-delete-marker', 'true')
    if (versionId) res.set('x-amz-version-id', versionId)
  }

  // S3 DeleteObject responds 204 No Content with an empty body, whether or not
  // the key existed (delete is idempotent).
  res.status(204).end()
}

// DeleteObject with a versionId targets a specific version. On the Autonomys
// DSN a version can never be destroyed, so this is refused with 403 AccessDenied
// — the truthful WORM answer: not a policy choice, the platform is incapable of
// it. (Delete WITHOUT a versionId still succeeds as a soft-delete / delete
// marker; only version destruction is forbidden.)
export const deleteObjectVersionHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  sendXML(res.status(403), 'Error', {
    Code: 'AccessDenied',
    Message:
      'Versions are permanent and cannot be destroyed. Autonomys DSN storage is immutable (COMPLIANCE-mode Object Lock); only the current version can be hidden with a delete marker (DeleteObject without a versionId).',
  })
}

export const copyObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)
  const source = parseCopySource(req)
  if (!source) {
    sendXML(res.status(400), 'Error', {
      Code: 'InvalidArgument',
      Message: 'The x-amz-copy-source header is missing or malformed.',
      ArgumentName: 'x-amz-copy-source',
    })
    return
  }

  // Metadata handling follows x-amz-metadata-directive (default COPY):
  //  - COPY:    the destination inherits the source's metadata → pass undefined
  //             for both mtime and metadata so the use case keeps the source's.
  //  - REPLACE: the destination's metadata is exactly what this request carries,
  //             so capture the request's mtime and object metadata verbatim. A
  //             missing value CLEARS it (REPLACE with no such header means the
  //             destination has none); rclone's SetModTime always sends
  //             REPLACE + mtime, so it still writes the intended value.
  const directive = req.headers['x-amz-metadata-directive']
  const isReplace =
    typeof directive === 'string' && directive.toUpperCase() === 'REPLACE'
  const mtime = isReplace ? getMtime(req) : undefined
  const metadata = isReplace ? getObjectMetadata(req) : undefined
  // REPLACE carries new metadata on the request; enforce the 2 KB user-metadata
  // limit here too. (COPY inherits the source's already-bounded metadata, so
  // `metadata` is undefined and this is a no-op.)
  if (rejectIfUserMetadataTooLarge(res, metadata)) return

  const result = await S3UseCases.copyObject(user, {
    SourceBucket: source.bucket,
    SourceKey: source.key,
    Bucket: bucket,
    Key: key,
    Mtime: mtime,
    Metadata: metadata,
  })

  if (result.isErr()) {
    // Source key not found in the caller's namespace → NoSuchKey, per S3.
    sendNoSuchKey(res, source.key)
    return
  }

  const { ETag, Cid, LastModified } = result.value
  res.set('x-amz-meta-cid', Cid)
  res.set('ETag', ETag)
  // versionId of the version this copy created = its content CID.
  res.set('x-amz-version-id', Cid)
  // The CopyObjectResult body carries ETag + LastModified. rclone re-HEADs the
  // destination afterward, so these are informational, but the XML must be
  // well-formed for the AWS SDK's response parser.
  sendXML(res, 'CopyObjectResult', {
    ETag,
    LastModified: LastModified.toISOString(),
  })
}

export const abortMultipartUploadHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const uploadId = req.query.uploadId as string
  if (!uploadId) {
    sendXML(res.status(400), 'Error', {
      Code: 'InvalidArgument',
      Message: 'The uploadId query parameter is required.',
      ArgumentName: 'uploadId',
    })
    return
  }

  const result = await S3UseCases.abortMultipartUpload(user, uploadId)
  if (result.isErr()) {
    if (result.error instanceof ForbiddenError) {
      sendXML(res.status(403), 'Error', {
        Code: 'AccessDenied',
        Message: 'You do not have permission to abort this multipart upload.',
        UploadId: uploadId,
      })
      return
    }
    // Unknown upload id → NoSuchUpload.
    sendXML(res.status(404), 'Error', {
      Code: 'NoSuchUpload',
      Message: 'The specified multipart upload does not exist.',
      UploadId: uploadId,
    })
    return
  }

  // S3 AbortMultipartUpload responds 204 No Content.
  res.status(204).end()
}

/**
 * Render ANY error escaping the S3 router as an S3 <Error> document.
 *
 * The per-handler mapping above only covers failures a handler returns. Plenty
 * never reach one: body-parser rejects an over-limit body (413) or a
 * Content-Encoding it cannot inflate (415) before the handler runs, and a throw
 * from a use case goes to asyncSafeHandler, which calls next(err) — Express's
 * default handler then answers an HTML 500, retryable to every S3 client and
 * rclone. Registering this last on the router covers all of them in one place
 * instead of one call site at a time.
 *
 * `encoding.unsupported` is called out because it has a real cause: a client
 * using chunked SigV4 sends `Content-Encoding: aws-chunked`, whose framing this
 * API does not decode. 501 NotImplemented says that, where 415 only says the
 * request was refused.
 */
export const s3ErrorHandler = (
  err: Error & { status?: number; statusCode?: number; type?: string },
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Mid-stream failures can't be re-answered; let Express destroy the socket.
  if (res.headersSent) return next(err)

  if (err.type === 'encoding.unsupported') {
    logger.warn(err, 'Refused an S3 request with an undecodable body encoding')
    sendXML(res.status(501), 'Error', {
      Code: 'NotImplemented',
      Message:
        'The Content-Encoding of this request body is not supported. Disable chunked/aws-chunked payload signing and send the body unencoded.',
    })
    return
  }

  const status = Number(err.statusCode ?? err.status ?? 500)
  const code = S3_ERROR_CODE_BY_STATUS[status] ?? 'InternalError'
  if (status >= 500) {
    logger.error(err, 'Unhandled error on the S3 API')
    sendXML(res.status(status), 'Error', {
      Code: code,
      Message: 'We encountered an internal error. Please try again.',
    })
    return
  }
  logger.warn(err, 'S3 request refused before it reached a handler')
  sendXML(res.status(status), 'Error', { Code: code, Message: err.message })
}

export const notImplementedHandler = async (_req: Request, res: Response) => {
  sendXML(res.status(501), 'Error', {
    Code: 'NotImplemented',
    Message: 'This S3 operation is not supported by Auto Drive.',
  })
}
