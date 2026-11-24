import { redirect } from 'next/navigation';
import { NetworkId, ROUTES } from '@auto-drive/ui';

// Usage moved under Organization; old links still land on it.
export default function Page({ params }: { params: { chain: NetworkId } }) {
  redirect(ROUTES.organizationUsage(params.chain));
}
