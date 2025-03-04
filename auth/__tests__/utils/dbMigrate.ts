import { closeDatabase, getDatabase } from '../../src/drivers/pg.js'
import dbMigrate from 'db-migrate'

let dbMigrateInstance: ReturnType<typeof dbMigrate.getInstance>

const up = async () => {
  await getDatabase()
  dbMigrateInstance = dbMigrate.getInstance(true)
  dbMigrateInstance.silence(true)
  await dbMigrateInstance.up()
}

const down = async () => {
  await closeDatabase()
  await dbMigrateInstance.down()
}

export const dbMigration = {
  up,
  down,
}
