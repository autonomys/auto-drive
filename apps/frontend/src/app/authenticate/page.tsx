import { defaultNetworkId } from '@auto-drive/ui';
import { redirect } from 'next/navigation';

export default function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const provider =
    typeof searchParams?.provider === 'string' ? searchParams.provider : null;
  const target = `/${defaultNetworkId}/drive/global`;
  if (!provider) {
    redirect(target);
  }

  redirect(`${target}?provider=${provider}`);
}
