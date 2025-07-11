import { ObjectUploadState, UploadStatus } from '@auto-drive/models'
import { nodesRepository } from '../../repositories/index.js'
import { uploadsRepository } from '../../repositories/uploads/uploads.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('useCases:objects:uploadStatus')

const getUploadStatus = async (cid: string): Promise<ObjectUploadState> => {
  logger.debug('Fetching upload status (cid=%s)', cid)
  const uploadStatus = await uploadsRepository.getStatusByCID(cid)
  const isMigratingOrPending =
    uploadStatus &&
    [UploadStatus.MIGRATING, UploadStatus.PENDING].includes(uploadStatus)

  if (isMigratingOrPending) {
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
