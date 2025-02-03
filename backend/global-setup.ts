import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RabbitMQContainer } from '@testcontainers/rabbitmq'
import { config } from 'dotenv'

export default async () => {
  config({ path: '.env.test' })
  const postgresContainer = new PostgreSqlContainer().withExposedPorts(54320)
  const service = await postgresContainer.start()
  const rabbitmqContainer = new RabbitMQContainer().withExposedPorts(
    5672,
    15672,
  )
  const rabbitmqService = await rabbitmqContainer.start()
  process.env.DATABASE_URL = service.getConnectionUri()
  process.env.RABBITMQ_URL = rabbitmqService.getAmqpUrl()
  global.__POSTGRES_CONTAINER__ = service
  global.__RABBITMQ_CONTAINER__ = rabbitmqService
}
