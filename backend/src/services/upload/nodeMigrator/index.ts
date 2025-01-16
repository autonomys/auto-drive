import { logger } from '../../../drivers/logger.js'
import { UploadsUseCases } from '../../../useCases/uploads/uploads.js'
import { safeCallback } from '../../../utils/safe.js'

const state = {
  executing: false,
  time: 10_000,
}

const processPendingMigrations = safeCallback(async () => {
  if (state.executing) {
    return
  }

  state.executing = true

  try {
    const pendingMigrations = await UploadsUseCases.getPendingMigrations(1)
    logger.info(`Found ${pendingMigrations.length} pending migrations`)
    if (pendingMigrations.length === 0) {
      return
    }

    for (const upload of pendingMigrations) {
      logger.info(`Processing migration for upload ${upload.id}`)
      await UploadsUseCases.processMigration(upload.id)
    }
  } finally {
    state.executing = false
  }
})

export const nodeMigrator = {
  start: (time: number = 10_000) => {
    state.time = time
    setInterval(processPendingMigrations, state.time)
  },
}
