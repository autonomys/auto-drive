export enum NetworkId {
  TAURUS = 'taurus',
  MAINNET = 'mainnet',
  LOCAL = 'local',
}

export interface Network {
  id: NetworkId;
  name: string;
  http: string;
  gql: string;
}

export const defaultNetworkId = NetworkId.TAURUS;

export const networks: Partial<Record<NetworkId, Network>> = {
  [NetworkId.TAURUS]: {
    id: NetworkId.TAURUS,
    name: 'Taurus',
    http:
      process.env.NEXT_PUBLIC_TAURUS_HTTP_URL ||
      'https://demo.auto-drive.autonomys.xyz/api',
    gql:
      process.env.NEXT_PUBLIC_TAURUS_GQL_URL ||
      'https://demo.auto-drive.autonomys.xyz/hasura/v1/graphql',
  },
};

if (process.env.NEXT_PUBLIC_ENV === 'local') {
  networks[NetworkId.LOCAL] = {
    id: NetworkId.LOCAL,
    name: 'Local',
    http: process.env.NEXT_PUBLIC_LOCAL_RPC_URL || 'http://localhost:3000',
    gql:
      process.env.NEXT_PUBLIC_LOCAL_GQL_URL ||
      'http://localhost:6565/v1/graphql',
  };
}

export const getNetwork = (networkId: NetworkId) => {
  if (!networks[networkId]) {
    throw new Error(`Network ${networkId} not found`);
  }
  return networks[networkId];
};
