import { Request, Response } from 'express'
import js2xmlparser from 'js2xmlparser'

export const sendXML = <T extends object>(
  res: Response,
  rootName: string,
  json: T,
) => {
  res.setHeader('Content-Type', 'application/xml')

  // Not for success bodies: they can carry a value the client sends back, such
  // as a continuation token, and a rewritten one would silently skip keys.
  res.send(
    js2xmlparser.parse(rootName, json, {
      replaceInvalidChars: rootName === 'Error',
    }),
  )
}

// A listing's query parameters as S3 reads them: a repeated parameter counts
// once, by its first value, a bracketed name such as max-keys[a] is a different
// parameter, and an unencoded '+' is a space. Express's req.query turns the
// first two into arrays and objects instead.
export const listingQuery = (req: Request): URLSearchParams => {
  const queryStart = req.originalUrl.indexOf('?')
  return new URLSearchParams(
    queryStart === -1 ? '' : req.originalUrl.slice(queryStart + 1),
  )
}

const DEFAULT_MAX_KEYS = 1000
const MAX_KEYS_CAP = 1000
const S3_MAX_KEYS_UPPER_BOUND = 2147483647

// Parses max-keys the way S3 does: an empty value counts as omitted, and an
// integer outside 0 to 2^31 - 1 is rejected. Returns null for a value S3 would
// reject.
export const parseMaxKeys = (value: string | null): number | null => {
  if (value === null || value === '') return DEFAULT_MAX_KEYS
  if (!/^[+-]?\d+$/.test(value)) return null
  const parsed = Number(value)
  if (parsed < 0 || parsed > S3_MAX_KEYS_UPPER_BOUND) return null
  // + 0 turns the -0 that Number('-0') returns into 0.
  return Math.min(parsed, MAX_KEYS_CAP) + 0
}

// S3 continuation tokens are opaque: clients send them back unchanged and do
// not URL-decode them under encoding-type=url. Ours names the key a page
// resumes after, which can hold characters XML cannot carry (file-server
// appends U+FFFF to step past a folder), so it travels as base64url.
export const encodeContinuationToken = (key: string): string =>
  Buffer.from(key, 'utf8').toString('base64url')

// Returns null for a token encodeContinuationToken did not produce.
export const decodeContinuationToken = (token: string): string | null => {
  const key = Buffer.from(token, 'base64url').toString('utf8')
  return encodeContinuationToken(key) === token ? key : null
}

// Characters XML 1.0 cannot represent: control characters other than TAB, LF
// and CR, and U+FFFE/U+FFFF. Lone surrogates are illegal too, but a key read
// back from Postgres cannot contain one.
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/

export const hasXmlIllegalChars = (value: string): boolean =>
  XML_ILLEGAL_CHARS.test(value)

// Inverse of the url.QueryUnescape that encoding-type=url clients (e.g. rclone)
// apply to every key, so encoding round-trips.
export const encodeS3Key = (value: string): string => encodeURIComponent(value)

export type ListingEncodingPlan = 'plain' | 'encode' | 'reject'

// `values` is every key, prefix and marker the response body will carry.
// 'encode': client opted into encoding-type=url — encode them all.
// 'reject': an illegal value is present without opt-in — caller returns 400.
// 'plain':  nothing illegal and no opt-in — render unchanged.
export const planListingEncoding = (
  values: string[],
  encodingType: string | null,
): ListingEncodingPlan => {
  if (encodingType === 'url') return 'encode'
  if (values.some(hasXmlIllegalChars)) return 'reject'
  return 'plain'
}
