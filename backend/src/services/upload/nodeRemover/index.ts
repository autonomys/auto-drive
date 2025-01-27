import { ObjectUseCases } from '../../../useCases/index.js'
import { safeCallback } from '../../../utils/safe.js'
import { downloadService } from '../../download/index.js'

const state = {
  executing: false,
  time: 10_000,
}

export const handleArchivedObjects = safeCallback(async () => {
  if (state.executing) {
    return
  }

  state.executing = true

  try {
    const cids = await ObjectUseCases.getNonArchivedObjects()

    for (const cid of cids) {
      const hasAllNodesArchived = await ObjectUseCases.hasAllNodesArchived(cid)
      if (hasAllNodesArchived) {
        await downloadService.download(cid)
        await ObjectUseCases.markAsArchived(cid)
      }
    }
  } finally {
    state.executing = false
  }
})

export const objectArchiver = {
  start: (time: number = 10_000) => {
    state.time = time
    setInterval(handleArchivedObjects, state.time)
  },
}
