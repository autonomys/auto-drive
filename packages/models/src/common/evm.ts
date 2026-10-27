/**
 * Strict EVM transaction hash format: 0x followed by 64 hex characters.
 * Shared by the backend refund validation and the frontend refund modal so
 * the two can never drift apart.
 */
export const EVM_TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/

export const isEvmTxHash = (value: string): boolean =>
  EVM_TX_HASH_REGEX.test(value)
