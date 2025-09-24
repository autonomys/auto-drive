export enum NetworkId {
  MAINNET = 'mainnet',
  LOCAL = 'local',
}

export interface Network {
  id: NetworkId
  name: string
  download: string
  http: string
  gql: string
}

export const defaultNetworkId = NetworkId.MAINNET

export const networks: Partial<Record<NetworkId, Network>> = {
  [NetworkId.MAINNET]: {
    id: NetworkId.MAINNET,
    name: 'Mainnet',
    http:
      process.env.NEXT_PUBLIC_MAINNET_HTTP_URL ||
      'https://mainnet.auto-drive.autonomys.xyz/api',
    download:
      process.env.NEXT_PUBLIC_MAINNET_DOWNLOAD_URL ||
      'https://public.auto-drive.autonomys.xyz/api',
    gql:
      process.env.NEXT_PUBLIC_MAINNET_GQL_URL ||
      'https://mainnet.auto-drive.autonomys.xyz/hasura/v1/graphql',
  },
}

if (process.env.NEXT_PUBLIC_ENV === 'local') {
  networks[NetworkId.LOCAL] = {
    id: NetworkId.LOCAL,
    name: 'Local',
    http: process.env.NEXT_PUBLIC_LOCAL_RPC_URL || 'http://localhost:3000',
    download:
      process.env.NEXT_PUBLIC_LOCAL_DOWNLOAD_URL || 'http://localhost:3030',
    gql:
      process.env.NEXT_PUBLIC_LOCAL_GQL_URL ||
      'http://localhost:6565/v1/graphql',
  }
}

export const getNetwork = (networkId: NetworkId) => {
  if (!networks[networkId]) {
    throw new Error(`Network ${networkId} not found`)
  }
  return networks[networkId]
}
