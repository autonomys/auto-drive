export default async () => {
  if (global.__POSTGRES_CONTAINER__ || global.__RABBITMQ_CONTAINER__) {
    await new Promise((resolve) => {
      global.__POSTGRES_CONTAINER__.stop()
      global.__RABBITMQ_CONTAINER__.stop()
      resolve(true)
    })
  } else {
    throw new Error('No database or rabbitmq container found')
  }
}
