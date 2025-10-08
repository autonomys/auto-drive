'use client';

import {
  darkTheme,
  getDefaultConfig,
  RainbowKitProvider,
} from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { FC, ReactNode, useMemo, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { evmChains } from '@auto-drive/ui';
import { useNetwork } from './network';

export const Web3Provider: FC<{ children: ReactNode }> = ({ children }) => {
  const [queryClient] = useState(() => new QueryClient({}));
  const { network } = useNetwork();
  const config = useMemo(
    () =>
      getDefaultConfig({
        appName: 'Auto Drive',
        projectId: process.env.NEXT_PUBLIC_PROJECT_ID || '',
        chains: [evmChains[network.id]],
        ssr: false,
      }),
    [],
  );

  return (
    <WagmiProvider config={config}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: createAsyncStoragePersister({ storage: localStorage }),
        }}
      >
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#0A8DD0',
            accentColorForeground: 'white',
            borderRadius: 'small',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
        >
          {children}
        </RainbowKitProvider>
      </PersistQueryClientProvider>
    </WagmiProvider>
  );
};
