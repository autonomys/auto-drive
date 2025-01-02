import { Metadata } from 'next';
import { Home } from '../views/Home';

export default function App() {
  return <Home />;
}

export const metadata: Metadata = {
  title: 'Auto-Drive',
  description:
    'Store, share, and download your files securely with autonomys decentralized permanent storage.',
};
