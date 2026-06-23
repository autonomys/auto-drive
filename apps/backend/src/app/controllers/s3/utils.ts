import { Response } from 'express'
import js2xmlparser from 'js2xmlparser'

export const sendXML = <T extends object>(
  res: Response,
  rootName: string,
  json: T,
) => {
  res.setHeader('Content-Type', 'application/xml')

  res.send(js2xmlparser.parse(rootName, json))
}

// Control characters XML 1.0 cannot represent (all except TAB, LF, CR).
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/

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
