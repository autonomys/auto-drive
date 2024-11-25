import { PostgreSqlContainer } from '@testcontainers/postgresql'

export default async () => {
  process.env.JWT_SECRET = 'secret'
  const container = new PostgreSqlContainer().withExposedPorts(54320)
  const service = await container.start()
  process.env.DATABASE_URL = service.getConnectionUri()
  global.__POSTGRES_CONTAINER__ = service
}
