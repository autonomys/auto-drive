/** Only explicit refusals/local validation failures prove that nothing was
 * submitted. Timeouts, disconnects, nonce errors and generic RPC errors don't. */
const hasCause = (
  error: unknown,
  matches: (error: { name?: unknown; code?: unknown }) => boolean,
): boolean => {
  const seen = new Set<unknown>();
  while (typeof error === 'object' && error !== null && !seen.has(error)) {
    seen.add(error);
    if (matches(error)) return true;
    error = (error as { cause?: unknown }).cause;
  }
  return false;
};

export const isWalletRejection = (error: unknown): boolean =>
  hasCause(error, (cause) => cause.code === 4001 || cause.code === 5750);

export const isBatchUnsupported = (error: unknown): boolean =>
  hasCause(error, (cause) =>
    [-32601, -32004, 4200, 5700, 5710, 5760].includes(cause.code as number),
  );

export const wasNotSubmitted = (error: unknown): boolean =>
  isWalletRejection(error) ||
  isBatchUnsupported(error) ||
  hasCause(
    error,
    (cause) =>
      [-32600, -32602, 4100, 5740].includes(cause.code as number) ||
      [
        'ChainMismatchError',
        'ChainNotConfiguredError',
        'ConnectorChainMismatchError',
        'ConnectorAccountNotFoundError',
        'ConnectorNotConnectedError',
        'ConnectorNotFoundError',
        'ProviderNotFoundError',
        'InsufficientFundsError',
      ].includes(cause.name as string),
  );
