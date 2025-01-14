import { ObjectUseCases } from '../../../useCases/index.js'
import { safeCallback } from '../../../utils/safe.js'

const state = {
  executing: false,
  time: 10_000,
}

const handleArchivedObjects = safeCallback(async () => {
  if (state.executing) {
    return
  }

  state.executing = true

  try {
    const cids = await ObjectUseCases.getNonArchivedObjects()

    for (const cid of cids) {
      const hasAllNodesArchived = await ObjectUseCases.hasAllNodesArchived(cid)
      if (hasAllNodesArchived) {
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
