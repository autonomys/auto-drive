import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { config } from 'dotenv'

export default async () => {
  config({ path: '.env.test' })
  const container = new PostgreSqlContainer().withExposedPorts(54320)
  const service = await container.start()
  process.env.DATABASE_URL = service.getConnectionUri()
  global.__POSTGRES_CONTAINER__ = service
}
