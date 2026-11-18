import { Response } from 'express'
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

const DEFAULT_MAX_KEYS = 1000
const S3_MAX_KEYS_UPPER_BOUND = 2147483647

// Parses max-keys the way S3 does: an empty value counts as omitted, a repeated
// parameter uses its first value, and an integer outside 0 to 2^31 - 1 is
// rejected. Returns null for a value S3 would reject.
export const parseMaxKeys = (raw: unknown): number | null => {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined || value === '') return DEFAULT_MAX_KEYS
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value)) return null
  const parsed = Number(value)
  if (parsed < 0 || parsed > S3_MAX_KEYS_UPPER_BOUND) return null
  return Math.min(Math.abs(parsed), DEFAULT_MAX_KEYS)
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

// 'encode': client opted into encoding-type=url — encode every key/prefix.
// 'reject': illegal keys present without opt-in — caller returns 400.
// 'plain':  nothing illegal and no opt-in — render unchanged.
export const planListingEncoding = (
  values: string[],
  encodingType: string | null,
): ListingEncodingPlan => {
  if (encodingType === 'url') return 'encode'
  if (values.some(hasXmlIllegalChars)) return 'reject'
  return 'plain'
}
