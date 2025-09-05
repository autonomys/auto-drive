'use client';

import { defaultNetworkId, networks, NetworkId } from '@auto-drive/ui';
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

  return <NetworkProvider network={network}>{children}</NetworkProvider>;
}
