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
): Promise<boolean> => {
  try {
    const baseUrl = config.filesGateway.url.replace(/\/+$/, '')
    const response = await fetch(`${baseUrl}/files/${cid}/metadata`, {
      headers: { Authorization: `Bearer ${config.filesGateway.token}` },
      signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
    })
    await response.body?.cancel().catch(() => {})
    return response.ok
  } catch (error) {
    logger.warn(error as Error, 'Gateway probe failed (cid=%s)', cid)
    return false
  }
}

export const FileGateway = {
  ...autoFilesApi,
  isRetrievableFromGateway,
}

