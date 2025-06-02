import { createContext, useContext, useEffect, useMemo } from 'react';
import { Network } from 'constants/networks';
import { Api, createApiService } from 'services/api';
import {
  ApolloClient,
  ApolloProvider,
  NormalizedCacheObject,
} from '@apollo/client';
import { createGQLClient } from 'services/gql';
import {
  createDownloadService,
  DownloadApi as DownloadService,
} from 'services/download';
import { createUploadService, UploadService } from 'services/upload';
import { useUserStore } from 'globalStates/user';

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
    return createApiService(network.http);
  }, [network]);

  const gql = useMemo(() => {
    return createGQLClient(network.gql);
  }, [network]);

  const downloadService = useMemo(() => {
    return createDownloadService(createApiService(network.download));
  }, [network]);

  const uploadService = useMemo(() => {
    return createUploadService(network.http);
  }, [network.http]);

  const setSubscription = useUserStore((e) => e.setSubscription);

  useEffect(() => {
    api.getSubscription().then((subscription) => {
      setSubscription(subscription);
    });
  }, [api, setSubscription]);

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
