import { closeAdminDatabase, getAdminDatabase } from '../../src/drivers/pg.js'
import dbMigrate from 'db-migrate'

let dbMigrateInstance: ReturnType<typeof dbMigrate.getInstance>

const up = async () => {
  await getAdminDatabase()
  dbMigrateInstance = dbMigrate.getInstance(true)
  dbMigrateInstance.silence(true)
  await dbMigrateInstance.up()
}

const down = async () => {
  await closeAdminDatabase()
  await dbMigrateInstance.down()
}

export const dbMigration = {
  up,
  down,
}
