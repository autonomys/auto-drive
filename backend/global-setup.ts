import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RabbitMQContainer } from '@testcontainers/rabbitmq'
import { Wait } from 'testcontainers'
import { config } from 'dotenv'
import fsPromise from 'fs/promises'

export default async () => {
  config({ path: '.env.test' })
  const postgresContainer = new PostgreSqlContainer(
    'postgres:16',
  ).withWaitStrategy(
    Wait.forLogMessage('database system is ready to accept connections'),
  )
  const service = await postgresContainer.start()
  const rabbitmqContainer = new RabbitMQContainer().withExposedPorts(
    5672,
    15672,
  )
  const rabbitmqService = await rabbitmqContainer.start()

  // Wiping the cache directory for not having any cache from previous tests
  await fsPromise
    .rm('.test-cache', {
      recursive: true,
      force: true,
    })
    // Ignore error if the cache directory does not exist
    .catch(() => {})
  process.env.DATABASE_URL = service.getConnectionUri()
  process.env.RABBITMQ_URL = rabbitmqService.getAmqpUrl()
  global.__POSTGRES_CONTAINER__ = service
  global.__RABBITMQ_CONTAINER__ = rabbitmqService
}
