import { create } from 'multiformats/hashes/digest'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { hash } from 'blake3'

export const hashData = (
  data: string | Buffer,
  algorithm: string = 'blake3',
): CID => {
  if (algorithm != 'blake3') {
    throw new Error('Invalid algorithm')
  }

  return CID.create(1, raw.code, create(0x1f, hash(data)))
}
