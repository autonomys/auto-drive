import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { config } from 'dotenv'
import { Wait } from 'testcontainers'

export default async () => {
  config({ path: '.env.test' })
  const postgresContainer = new PostgreSqlContainer(
    'postgres:16',
  ).withWaitStrategy(
    Wait.forLogMessage('database system is ready to accept connections'),
  )
  const service = await postgresContainer.start()
  process.env.DATABASE_URL = service.getConnectionUri()
  global.__POSTGRES_CONTAINER__ = service
}
