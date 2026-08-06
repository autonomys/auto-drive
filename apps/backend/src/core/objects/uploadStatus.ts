import { ObjectUploadState, UploadStatus } from '@auto-drive/models'
import { nodesRepository } from '../../infrastructure/repositories/index.js'
import { uploadsRepository } from '../../infrastructure/repositories/uploads/uploads.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('useCases:objects:uploadStatus')

const getUploadStatus = async (cid: string): Promise<ObjectUploadState> => {
  logger.debug('Fetching upload status (cid=%s)', cid)
  const uploadStatus = await uploadsRepository.getStatusByCID(cid)
  // COMPLETING and FAILED are included deliberately: an upload row still exists
  // for both (only a successful migration removes the artifacts) and neither has
  // written any nodes, so the counting path below would report 0 uploaded of 0
  // total and 0 archived of 0 total. Returning explicit nulls says "no counts
  // yet" instead of handing callers zeroes that every ratio reads as complete.
  //
  // This is about the API being honest, not about a live UI bug: objectStatus()
  // maps totalNodes === 0 to Processing before it compares archivedNodes to
  // totalNodes, and the web app's file lists compute uploadState from Hasura
  // aggregates rather than this endpoint — so neither renders a false "archived"
  // today. It is REST/SDK consumers doing their own arithmetic that the zeroes
  // mislead.
  //
  // Surfacing a distinct failed state to the user needs a new ObjectUploadState
  // field plus frontend work; until then a FAILED upload reads as Processing,
  // and auto_drive_upload_migration_unrecoverable (emitted where the upload is
  // parked) is what makes it visible to us.
  const hasNoNodesYet =
    uploadStatus &&
    [
      UploadStatus.MIGRATING,
      UploadStatus.PENDING,
      UploadStatus.COMPLETING,
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
