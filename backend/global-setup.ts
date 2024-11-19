import dbMigrate from 'db-migrate'
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'

export default async () => {
  const container = new PostgreSqlContainer().withExposedPorts(54320)
  const service = await container.start()
  process.env.DATABASE_URL = service.getConnectionUri()
  global.__POSTGRES_CONTAINER__ = service
  process.env.POSTGRES_USER = service.getId()
  await dbMigrate.getInstance(true).up()
}

declare global {
  // eslint-disable-next-line no-var
  var __POSTGRES_CONTAINER__: StartedPostgreSqlContainer
}
