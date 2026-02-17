export interface RuntimeConfig {
  authApiUrl: string;
  maxFilesLimit: number;
  projectId: string;
  rpcEndpoint: string;
  objectStoreVersion: string;
  env: string;
  mainnetHttpUrl: string;
  mainnetDownloadUrl: string;
  mainnetGqlUrl: string;
  localRpcUrl: string;
  localDownloadUrl: string;
  localGqlUrl: string;
}

export function getServerRuntimeConfig(): RuntimeConfig {
  return {
    authApiUrl:
      process.env.NEXT_PUBLIC_AUTH_API_URL || 'http://localhost:3030',
    maxFilesLimit: parseInt(
      process.env.NEXT_PUBLIC_MAX_FILES_LIMIT || '10',
      10,
    ),
    projectId: process.env.NEXT_PUBLIC_PROJECT_ID || '',
    rpcEndpoint: process.env.NEXT_PUBLIC_RPC_ENDPOINT || '',
    objectStoreVersion:
      process.env.NEXT_PUBLIC_OBJECT_STORE_VERSION || 'v1',
    env: process.env.NEXT_PUBLIC_ENV || '',
    mainnetHttpUrl:
      process.env.NEXT_PUBLIC_MAINNET_HTTP_URL ||
      'https://mainnet.auto-drive.autonomys.xyz/api',
    mainnetDownloadUrl:
      process.env.NEXT_PUBLIC_MAINNET_DOWNLOAD_URL ||
      'https://public.auto-drive.autonomys.xyz/api',
    mainnetGqlUrl:
      process.env.NEXT_PUBLIC_MAINNET_GQL_URL ||
      'https://mainnet.auto-drive.autonomys.xyz/hasura/v1/graphql',
    localRpcUrl:
      process.env.NEXT_PUBLIC_LOCAL_RPC_URL || 'http://localhost:3000',
    localDownloadUrl:
      process.env.NEXT_PUBLIC_LOCAL_DOWNLOAD_URL || 'http://localhost:3030',
    localGqlUrl:
      process.env.NEXT_PUBLIC_LOCAL_GQL_URL ||
      'http://localhost:6565/v1/graphql',
  };
}
