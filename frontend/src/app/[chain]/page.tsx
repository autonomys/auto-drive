import { redirect } from 'next/navigation';
import { NetworkId } from '../../constants/networks';

export default async function Page({
  params,
}: {
  params: Promise<{ chain: NetworkId }>;
}) {
  const { chain } = await params;

  redirect(`/${chain}/drive`);
}
