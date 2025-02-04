import { closeDatabase, getDatabase } from '../../src/drivers/pg'
import dbMigrate from 'db-migrate'
import { Rabbit } from '../../src/drivers/rabbit'

let dbMigrateInstance: ReturnType<typeof dbMigrate.getInstance>

const up = async () => {
  await getDatabase()
  await Rabbit.init()
  dbMigrateInstance = dbMigrate.getInstance(true)
  dbMigrateInstance.silence(true)
  await dbMigrateInstance.up()
}

const down = async () => {
  await closeDatabase()
  await Rabbit.close()
  await dbMigrateInstance.down()
}

export const dbMigration = {
  up,
  down,
}
