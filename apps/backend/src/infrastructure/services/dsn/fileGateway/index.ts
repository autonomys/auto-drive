import { config } from '../../../../config.js'
import { createAutoFilesApi } from '@autonomys/auto-files'

export const FileGateway = createAutoFilesApi(
  config.filesGateway.url,
  config.filesGateway.token,
)

/**
 * Fetches one chunk's payload from the gateway.
 *
 * This is the same endpoint the SDK's own getChunkedFile uses, reimplemented
 * here for one reason: the SDK only exposes it behind getFile, whose Readable
 * pulls exactly one chunk per read() call. That makes a cold retrieval one
 * sequential HTTP round-trip per chunk — for a 1.28 GB object, 19,649 of them
 * in series, which is the bulk of the twenty-plus minutes a large uncached
 * download takes. Calling the endpoint directly lets us keep many requests in
 * flight at once.
 *
 * Deliberately not built on FileGateway.getNode: that route returns a decoded
 * PBNode as JSON (res.json), so its bytes are JSON text rather than the chunk
 * payload, and nothing IPLD-decodes them on the way back.
 *
 * @returns the chunk's bytes, or null once the index is past the last chunk
 *   (the gateway answers 204 there, which is how the end is detected).
 */
export const fetchFileChunk = async (
  cid: string,
  chunk: number,
): Promise<Buffer | null> => {
  const url = new URL(`${config.filesGateway.url}/files/${cid}/partial`)
  url.searchParams.set('chunk', chunk.toString())

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${config.filesGateway.token}` },
  })

  if (response.status === 204) {
    return null
  }

  if (!response.ok) {
    throw new Error(
      `Error fetching chunk ${chunk} of ${cid}: ${response.status} ${response.statusText}`,
    )
  }

  return Buffer.from(await response.arrayBuffer())
}
