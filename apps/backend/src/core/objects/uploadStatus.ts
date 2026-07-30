import { ObjectUploadState, UploadStatus } from '@auto-drive/models'
import { nodesRepository } from '../../infrastructure/repositories/index.js'
import { uploadsRepository } from '../../infrastructure/repositories/uploads/uploads.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('useCases:objects:uploadStatus')

const getUploadStatus = async (cid: string): Promise<ObjectUploadState> => {
  logger.debug('Fetching upload status (cid=%s)', cid)
  const uploadStatus = await uploadsRepository.getStatusByCID(cid)
  // FAILED is included deliberately. An upload row still exists for it (only a
  // successful migration removes the artifacts), so its nodes were never written
  // and the counting path below would report 0 uploaded of 0 total — which reads
  // as "fully published" rather than "never published". Returning the same
  // all-null state as an in-progress upload keeps that from being reported as
  // success. Surfacing a distinct failed state to the user needs a new
  // ObjectUploadState field plus frontend work; tracked separately.
  const hasNoNodesYet =
    uploadStatus &&
    [
      UploadStatus.MIGRATING,
      UploadStatus.PENDING,
      UploadStatus.FAILED,
    ].includes(uploadStatus)

  if (hasNoNodesYet) {
    logger.trace('Upload is in %s state (cid=%s)', uploadStatus, cid)
    return {
      uploadedNodes: null,
      totalNodes: null,
      archivedNodes: null,
      minimumBlockDepth: null,
      maximumBlockDepth: null,
    }
  }

  logger.trace('Fetching node counts and upload status (cid=%s)', cid)
  const { totalCount, publishedCount, archivedCount } =
    await nodesRepository.getNodeCount({
      rootCid: cid,
    })
  const uploadedNodes = await nodesRepository.getUploadedNodesByRootCid(cid)

  const minimumBlockDepth = uploadedNodes
    .filter((e) => e.block_published_on)
    .map((e) => e.block_published_on!)
    .reduce((a, b) => (a === null ? b : Math.min(a, b)), null as number | null)

  const maxSeenBlockDepth = uploadedNodes
    .filter((e) => e.block_published_on)
    .map((e) => e.block_published_on!)
    .reduce((a, b) => (a === null ? b : Math.max(a, b)), null as number | null)

  const isFullyUploaded = uploadedNodes.length === publishedCount

  const maximumBlockDepth = isFullyUploaded ? maxSeenBlockDepth : null

  logger.debug(
    'Upload status details (cid=%s, uploaded=%d, total=%d, archived=%d, minDepth=%s, maxDepth=%s)',
    cid,
    uploadedNodes.length,
    totalCount,
    archivedCount,
    minimumBlockDepth ?? 'null',
    maximumBlockDepth ?? 'null',
  )

  return {
    uploadedNodes: uploadedNodes.length,
    totalNodes: totalCount,
    archivedNodes: archivedCount,
    minimumBlockDepth,
    maximumBlockDepth,
  }
}

export const UploadStatusUseCases = {
  getUploadStatus,
}
