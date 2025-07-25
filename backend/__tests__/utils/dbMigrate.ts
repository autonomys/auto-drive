import dbMigrate from 'db-migrate'
import { Rabbit } from '../../src/infrastructure/drivers/rabbit.js'
import { jest } from '@jest/globals'

let dbMigrateInstance: ReturnType<typeof dbMigrate.getInstance>

const up = async () => {
  dbMigrateInstance = dbMigrate.getInstance(true)
  dbMigrateInstance.silence(true)
  await dbMigrateInstance.up()
}

const down = async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  await Rabbit.close()
  await dbMigrateInstance.down()
  jest.restoreAllMocks()
}

export const dbMigration = {
  up,
  down,
}
