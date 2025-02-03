import { logger } from '../../../drivers/logger.js'
import { ObjectUseCases } from '../../../useCases/index.js'
import { safeCallback } from '../../../utils/safe.js'
import { downloadService } from '../../download/index.js'

export const handleArchivedObjects = safeCallback(async () => {
  try {
    const cids = await ObjectUseCases.getNonArchivedObjects()

    for (const cid of cids) {
      const hasAllNodesArchived = await ObjectUseCases.hasAllNodesArchived(cid)
      if (hasAllNodesArchived) {
        await downloadService.download(cid)
        await ObjectUseCases.processArchival(cid)
      }
    }
  } catch (error) {
    logger.error(error)
  }
})
