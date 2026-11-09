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
  totalSize: bigint | number = 0n,
): Promise<boolean> => {
  const size = BigInt(totalSize)
  // For an empty object there is nothing to confirm
  if (size === 0n) {
    return true
  }

  try {
    const baseUrl = config.filesGateway.url.replace(/\/+$/, '')
    const lastByte = size - 1n
    const response = await fetch(
      `${baseUrl}/files/${cid}?originControl=no-cache`,
      {
        headers: {
          Authorization: `Bearer ${config.filesGateway.token}`,
          Range: `bytes=${lastByte}-${lastByte}`,
        },
        signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
      },
    )

    if (response.status !== 206 || !response.body) {
      await response.body?.cancel().catch(() => {})
      return false
    }

    // Read body to end: chunks are fetched lazily after headers,
    // so a missing chunk only surfaces mid-body.
    let bytesRead = 0
    const MAX_BYTES = 8192
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytesRead += chunk.length
      if (bytesRead >= MAX_BYTES) break
    }

    return bytesRead > 0
  } catch (error) {
    logger.warn(error as Error, 'Gateway probe failed (cid=%s)', cid)
    return false
  }
}

export const FileGateway = {
  ...autoFilesApi,
  isRetrievableFromGateway,
}

