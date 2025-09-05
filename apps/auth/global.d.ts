import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

declare global {
  // eslint-disable-next-line no-var
  var __POSTGRES_CONTAINER__: StartedPostgreSqlContainer
}

export {}
