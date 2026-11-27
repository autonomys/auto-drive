import dbMigrate from 'db-migrate'
import { Rabbit } from '../../src/infrastructure/drivers/rabbit.js'
import { jest } from '@jest/globals'

let dbMigrateInstance: ReturnType<typeof dbMigrate.getInstance>

// EventRouter.publish does not await Rabbit.publish. Closing the channel under
// a publish that is still connecting makes it retry on a new connection that
// nothing closes, so down() waits for every publish a test started.
let publishes: Promise<void>[] = []
const publish = Rabbit.publish
Rabbit.publish = (queue, message) => {
  const pending = publish(queue, message)
  publishes.push(pending)
  return pending
}

const up = async () => {
  dbMigrateInstance = dbMigrate.getInstance(true)
  dbMigrateInstance.silence(true)
  await dbMigrateInstance.up()
}

const down = async () => {
  await Promise.allSettled(publishes)
  publishes = []
  await Rabbit.close()
  await dbMigrateInstance.down()
  jest.restoreAllMocks()
}

export const dbMigration = {
  up,
  down,
}
