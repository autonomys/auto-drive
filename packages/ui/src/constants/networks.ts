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

export interface NetworkConfig {
  mainnetHttpUrl?: string
  mainnetDownloadUrl?: string
  mainnetGqlUrl?: string
  env?: string
  localRpcUrl?: string
  localDownloadUrl?: string
  localGqlUrl?: string
}

export const defaultNetworkId = NetworkId.MAINNET

export function buildNetworks(
  config: NetworkConfig = {},
): Partial<Record<NetworkId, Network>> {
  const result: Partial<Record<NetworkId, Network>> = {
    [NetworkId.MAINNET]: {
      id: NetworkId.MAINNET,
      name: 'Mainnet',
      http:
        config.mainnetHttpUrl ||
        'https://mainnet.auto-drive.autonomys.xyz/api',
      download:
        config.mainnetDownloadUrl ||
        'https://public.auto-drive.autonomys.xyz/api',
      gql:
        config.mainnetGqlUrl ||
        'https://mainnet.auto-drive.autonomys.xyz/hasura/v1/graphql',
    },
  }

  if (config.env === 'local') {
    result[NetworkId.LOCAL] = {
      id: NetworkId.LOCAL,
      name: 'Local',
      http: config.localRpcUrl || 'http://localhost:3000',
      download: config.localDownloadUrl || 'http://localhost:3030',
      gql: config.localGqlUrl || 'http://localhost:6565/v1/graphql',
    }
  }

  return result
}

// Backward compat: static export for non-Docker / local dev usage
export const networks: Partial<Record<NetworkId, Network>> = buildNetworks({
  mainnetHttpUrl: process.env.NEXT_PUBLIC_MAINNET_HTTP_URL,
  mainnetDownloadUrl: process.env.NEXT_PUBLIC_MAINNET_DOWNLOAD_URL,
  mainnetGqlUrl: process.env.NEXT_PUBLIC_MAINNET_GQL_URL,
  env: process.env.NEXT_PUBLIC_ENV,
  localRpcUrl: process.env.NEXT_PUBLIC_LOCAL_RPC_URL,
  localDownloadUrl: process.env.NEXT_PUBLIC_LOCAL_DOWNLOAD_URL,
  localGqlUrl: process.env.NEXT_PUBLIC_LOCAL_GQL_URL,
})

export const getNetwork = (networkId: NetworkId) => {
  if (!networks[networkId]) {
    throw new Error(`Network ${networkId} not found`)
  }
  return networks[networkId]
}
