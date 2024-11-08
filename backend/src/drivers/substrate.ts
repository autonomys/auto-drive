import { ApiPromise, WsProvider } from '@polkadot/api'

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'ws://localhost:9944'

export const createConnection = (): Promise<ApiPromise> => {
  const provider = new WsProvider(RPC_ENDPOINT)

  return ApiPromise.create({
    provider,
  })
}
