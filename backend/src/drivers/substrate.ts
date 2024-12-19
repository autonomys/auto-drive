import { ApiPromise, WsProvider } from '@polkadot/api'
import { config } from '../config'

export const createConnection = (): Promise<ApiPromise> => {
  const provider = new WsProvider(config.rpcEndpoint)

  return ApiPromise.create({
    provider,
  })
}
