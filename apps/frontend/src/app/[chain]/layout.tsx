'use client';

import dynamic from 'next/dynamic';
import { defaultNetworkId, NetworkId, networks } from '@auto-drive/ui';
import { NetworkProvider } from '../../contexts/network';

const WalletProvider = dynamic(
  () => import('@/contexts/web3').then((mod) => mod.Web3Provider),
  {
    ssr: false,
  },
);

export default function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { chain: NetworkId };
}) {
  const network =
    params.chain in networks
      ? networks[params.chain as NetworkId]!
      : networks[defaultNetworkId]!;

  return (
    <NetworkProvider network={network}>
      <WalletProvider>{children}</WalletProvider>
    </NetworkProvider>
  );
}
