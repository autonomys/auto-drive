import { ApiPromise, WsProvider } from '@polkadot/api'
import { config } from '../config.js'

export const createConnection = (): Promise<ApiPromise> => {
  const provider = new WsProvider(config.chain.endpoint)

  return ApiPromise.create({
    provider,
  })
}
