import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq'
declare global {
  // eslint-disable-next-line no-var
  var __POSTGRES_CONTAINER__: StartedPostgreSqlContainer
  // eslint-disable-next-line no-var
  var __RABBITMQ_CONTAINER__: StartedRabbitMQContainer
}

export {}
