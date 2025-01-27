import { redirect } from 'next/navigation';
import { defaultNetworkId, NetworkId } from '../../constants/networks';

export default function Page({
  params: { chain },
}: {
  params: { chain: string };
}) {
  redirect(`/${chain}/drive`);
}

export const getDrivePath = (networkId: NetworkId = defaultNetworkId) => {
  return `/${networkId}/drive`;
};
