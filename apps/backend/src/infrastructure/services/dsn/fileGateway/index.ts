import { Readable } from 'stream'
import { config } from '../../../../config.js'
import { createAutoFilesApi } from '@autonomys/auto-files'
import { createLogger } from '../../../drivers/logger.js'
import { withTimeout } from '../../../../shared/utils/timeout.js'

const logger = createLogger('services:dsn:fileGateway')

export const FileGateway = createAutoFilesApi(
  config.filesGateway.url,
  config.filesGateway.token,
)

/**
 * Whether the gateway already holds this file, and can therefore stream it back
 * in one response instead of being asked for it chunk by chunk.
 *
 * Answers false when the check itself fails: the caller's fallback is to
 * compose the file from chunks, which works either way, so a status hiccup must
 * not fail a download that could still succeed.
 */
export const isFileCachedOnGateway = async (cid: string): Promise<boolean> => {
  try {
    return (
      (await withTimeout(
        FileGateway.isFileCached(cid),
        config.filesGateway.fetchTimeoutMs,
        `FileGateway.isFileCached(${cid})`,
      )) === true
    )
  } catch (error) {
    logger.warn(
      error as Error,
      'Could not read gateway cache status for cid=%s; assuming uncached',
      cid,
    )
    return false
  }
}

/**
 * The gateway's own single-response stream for a file it has already
 * reconstructed.
 *
 * Only worth calling behind isFileCachedOnGateway: on a miss the SDK falls back
 * to composing the file one chunk per read(), in series, which is the pathology
 * composeGatewayFileReadable exists to avoid.
 */
export const fetchGatewayFile = (cid: string): Promise<Readable> =>
  FileGateway.getFile(cid)

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
 * Takes a signal so a caller that gives up on a chunk can hand the connection
 * back. Without it an abandoned request keeps its slot for as long as the
 * gateway holds it open, and the callers here run many at once — so the ones
 * that timed out would crowd out the ones still worth waiting for.
 *
 * @returns the chunk's bytes, or null once the index is past the last chunk
 *   (the gateway answers 204 there, which is how the end is detected).
 */
export const fetchFileChunk = async (
  cid: string,
  chunk: number,
  signal?: AbortSignal,
): Promise<Buffer | null> => {
  const url = new URL(`${config.filesGateway.url}/files/${cid}/partial`)
  url.searchParams.set('chunk', chunk.toString())

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${config.filesGateway.token}` },
    signal,
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
