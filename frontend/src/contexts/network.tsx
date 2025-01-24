import { createContext, useContext, useMemo } from 'react';
import { Network } from '../constants/networks';
import { Api, createApiService } from '../services/api';
import {
  ApolloClient,
  ApolloProvider,
  NormalizedCacheObject,
} from '@apollo/client';
import { createGQLClient } from '../services/gql';
import {
  createDownloadService,
  DownloadApi as DownloadService,
} from '../services/download';
import { createUploadService, UploadService } from '../services/upload';

interface NetworkArtifact {
  network: Network;
  api: Api;
  gql: ApolloClient<NormalizedCacheObject>;
  downloadService: DownloadService;
  uploadService: UploadService;
}

export const NetworkContext = createContext<NetworkArtifact>(
  {} as NetworkArtifact,
);

export const NetworkProvider = ({
  children,
  network,
}: {
  children: React.ReactNode;
  network: Network;
}) => {
  const api = useMemo(() => {
    console.log('creating api service', network.http);

    return createApiService(network.http);
  }, [network]);

  const gql = useMemo(() => {
    return createGQLClient(network.gql);
  }, [network]);

  const downloadService = useMemo(() => {
    console.log('creating download service', network.http);
    return createDownloadService(api);
  }, [api, network.http]);

  const uploadService = useMemo(() => {
    return createUploadService(network.http);
  }, [network.http]);

  return (
    <NetworkContext.Provider
      value={{ network, api, gql, downloadService, uploadService }}
    >
      <ApolloProvider client={gql}>{children}</ApolloProvider>
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => {
  const network = useContext(NetworkContext);

  return network;
};
