'use client';

import dynamic from 'next/dynamic';

const WalletProvider = dynamic(
  () => import('@/contexts/web3').then((mod) => mod.Web3Provider),
  {
    ssr: false,
  },
);

interface ClientWalletProviderProps {
  children: React.ReactNode;
}

export default function ClientWalletProvider({
  children,
}: ClientWalletProviderProps) {
  return <WalletProvider>{children}</WalletProvider>;
}
