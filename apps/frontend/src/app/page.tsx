import { redirect } from 'next/navigation';
import { ROUTES, defaultNetworkId } from '@auto-drive/ui';

export default function App() {
  redirect(ROUTES.globalFeed(defaultNetworkId));
}
