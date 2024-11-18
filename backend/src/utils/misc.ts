export const stringify = (value: unknown) => {
  return JSON.stringify(value, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  )
}
