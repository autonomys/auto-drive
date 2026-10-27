import { ApiPromise, WsProvider } from '@polkadot/api'
import { config } from '../../config.js'
import { createLogger } from './logger.js'

const logger = createLogger('drivers:substrate')

export const createConnection = (): Promise<ApiPromise> => {
  const provider = new WsProvider(config.chain.endpoint)

  // Surface the WebSocket connection lifecycle. WsProvider auto-reconnects on a
  // dropped socket, but an RPC subscription opened on the old socket can stop
  // delivering after the reconnect while one-shot calls (getHeader/getBlockHash)
  // keep working — which is exactly what strands a publish transaction in
  // "publishing" (see the confirmation poll fallback in transactionManager).
  // Logging connect/disconnect makes a reconnect visible in the trace so a
  // stalled confirmation can be correlated with a socket blip rather than
  // inferred from a frozen queue.
  provider.on('connected', () =>
    logger.info('Substrate RPC connected: %s', config.chain.endpoint),
  )
  provider.on('disconnected', () =>
    logger.warn(
      'Substrate RPC disconnected: %s (WsProvider will auto-reconnect)',
      config.chain.endpoint,
    ),
  )
  provider.on('error', (error) =>
    logger.error(error as Error, 'Substrate RPC provider error'),
  )

  return ApiPromise.create({
    provider,
  })
}
