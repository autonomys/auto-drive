import { config } from '../../../../config.js'
import { createAutoFilesApi } from '@autonomys/auto-files'
import { createLogger } from '../../../drivers/logger.js'

const logger = createLogger('dsn:fileGateway')

const GATEWAY_PROBE_TIMEOUT_MS = config.reclaim.probeTimeoutMs

const autoFilesApi = createAutoFilesApi(
  config.filesGateway.url,
  config.filesGateway.token,
)

/**
 * Whether the gateway can serve this object right now.
 *
 * Unknown resolves to false. The only decision this gates is deleting our own
 * copy, and "keep it" is the safe answer to "don't know" — a false negative
 * costs a few MB of retention until the next sweep; a false positive is
 * unrecoverable data loss.
 */
export const isRetrievableFromGateway = async (
  cid: string,
  totalSize: bigint,
): Promise<boolean> => {
  // For an empty object there is nothing to confirm
  if (totalSize === 0n) {
    return true
  }

  const baseUrl = config.filesGateway.url.replace(/\/+$/, '')
  const lastByte = totalSize - 1n
  let response: Response
  try {
    response = await fetch(
      `${baseUrl}/files/${cid}?originControl=no-cache`,
      {
        headers: {
          Authorization: `Bearer ${config.filesGateway.token}`,
          Range: `bytes=${lastByte}-${lastByte}`,
        },
        signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
      },
    )
  } catch (error) {
    logger.warn(error as Error, 'Gateway probe network/timeout failure (cid=%s)', cid)
    throw error
  }

  if (response.status !== 206 || !response.body) {
    await response.body?.cancel().catch(() => {})
    if (response.status >= 500) {
      throw new Error(
        `Gateway probe returned server error status ${response.status} (cid=${cid})`,
      )
    }
    return false
  }

  // Read body to end: chunks are fetched lazily after headers,
  // so a missing chunk only surfaces mid-body.
  let bytesRead = 0
  const MAX_BYTES = 8192
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytesRead += chunk.length
      if (bytesRead >= MAX_BYTES) break
    }
  } catch (error) {
    logger.warn(error as Error, 'Gateway probe stream read failure (cid=%s)', cid)
    throw error
  }

  return bytesRead === 1
}

export const FileGateway = {
  ...autoFilesApi,
  isRetrievableFromGateway,
}

