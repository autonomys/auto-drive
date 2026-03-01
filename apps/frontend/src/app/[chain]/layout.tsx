'use client';

import dynamic from 'next/dynamic';
import { buildNetworks, defaultNetworkId, NetworkId } from '@auto-drive/ui';
import { NetworkProvider } from '../../contexts/network';
import { useRuntimeConfig } from '@/config/RuntimeConfigProvider';

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
  const config = useRuntimeConfig();
  const nets = buildNetworks(config);
  const network =
    params.chain in nets
      ? nets[params.chain as NetworkId]!
      : nets[defaultNetworkId]!;

  return (
    <NetworkProvider network={network}>
      <WalletProvider>{children}</WalletProvider>
    </NetworkProvider>
  );
}
