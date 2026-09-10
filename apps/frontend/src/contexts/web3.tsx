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
import {
  evmChains,
  usdcPaymentChains,
  usdcPaymentTransports,
} from '@auto-drive/ui';
import { http } from 'viem';
import { useNetwork } from './network';

export const Web3Provider: FC<{ children: ReactNode }> = ({ children }) => {
  const [queryClient] = useState(() => new QueryClient({}));
  const { network } = useNetwork();
  const config = useMemo(
    () =>
      getDefaultConfig({
        appName: 'Auto Drive',
        projectId: process.env.NEXT_PUBLIC_PROJECT_ID || '',
        // Auto EVM first, and it stays first: wagmi treats the head of this list
        // as the default chain, and the AI3 flow — every purchase today — must
        // keep connecting exactly where it does now.
        //
        // The Ethereum chains are here so a USDC purchase can switch to whichever
        // one the backend names and read an allowance on it. A chain wagmi is
        // configured with but never asked to switch to costs nothing; one it is
        // NOT configured with cannot be switched to at all, which is why this
        // cannot wait until the target is known.
        chains: [evmChains[network.id], ...usdcPaymentChains],
        // Explicit per-chain transports. Auto EVM keeps the endpoint its own
        // chain definition carries; the Ethereum chains take a configured RPC
        // when there is one, because this flow reads a balance and an allowance
        // before it can do anything, and a rate-limited public RPC turns that
        // into a failed purchase for a wallet that was perfectly funded.
        transports: {
          [evmChains[network.id].id]: http(),
          ...usdcPaymentTransports,
        },
        ssr: false,
      }),
    [network.id],
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
