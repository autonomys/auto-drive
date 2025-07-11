export default async () => {
  if (global.__POSTGRES_CONTAINER__ || global.__RABBITMQ_CONTAINER__) {
    await new Promise((resolve) => {
      setTimeout(() => {
        global.__POSTGRES_CONTAINER__.stop()
        global.__RABBITMQ_CONTAINER__.stop()
        process.emit('beforeExit', 0)
        resolve(true)
      }, 2_000)
    })
  } else {
    throw new Error('No database or rabbitmq container found')
  }
}
