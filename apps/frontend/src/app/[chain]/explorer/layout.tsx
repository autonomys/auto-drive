'use client';

import { LandingLayout } from '@/components/layouts/LandingLayout';
import { defaultNetworkId, networks, NetworkId } from '@/constants/networks';
import { NetworkProvider } from '../../../contexts/network';

export default function ExplorerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { chain: string };
}) {
  const network =
    params.chain in networks
      ? networks[params.chain as NetworkId]!
      : networks[defaultNetworkId]!;

  return (
    <LandingLayout>
      <NetworkProvider network={network}>{children}</NetworkProvider>
    </LandingLayout>
  );
}
