export default async () => {
  if (global.__POSTGRES_CONTAINER__) {
    await global.__POSTGRES_CONTAINER__.stop()
  } else {
    throw new Error('No database container found')
  }
}