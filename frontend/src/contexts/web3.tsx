'use client';

import {
  darkTheme,
  getDefaultConfig,
  RainbowKitProvider,
} from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FC, ReactNode, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { Chain } from 'wagmi/chains';

export const nova: Chain = {
  id: 490000,
  name: 'Auto EVM - Autonomys Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'tAI3',
    symbol: 'tAI3',
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RPC_ENDPOINT || ''],
    },
    public: {
      http: [process.env.NEXT_PUBLIC_RPC_ENDPOINT || ''],
    },
  },
  blockExplorers: {
    default: {
      name: 'Auto EVM Explorer',
      url: 'https://blockscout.taurus.autonomys.xyz/',
    },
  },
};

const config = getDefaultConfig({
  appName: 'Auto Drive',
  projectId: process.env.NEXT_PUBLIC_PROJECT_ID || '',
  chains: [nova],
  ssr: true,
});

export const Web3Provider: FC<{ children: ReactNode }> = ({ children }) => {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
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
      </QueryClientProvider>
    </WagmiProvider>
  );
};
