import { defaultNetworkId, ROUTES } from '@auto-drive/ui';
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

  // The landing page's sign-in buttons end in My Files, whether or not the
  // visitor already has a session.
  redirect(
    `${target}?${new URLSearchParams({ provider, callbackUrl: ROUTES.drive(defaultNetworkId) })}`,
  );
}
