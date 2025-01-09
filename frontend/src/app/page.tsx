import { Metadata } from 'next';
import { Home } from '../views/Home';

export default function App() {
  return <Home />;
}

export const metadata: Metadata = {
  title: 'Auto Drive',
  description:
    'Store, share, and download your files securely with Autonomys Network decentralized permanent storage.',
  keywords:
    'autonomys, auto-drive, decentralized storage, permanent storage, autonomys network, file storage, file sharing, secure storage, blockchain storage, distributed storage, cloud storage alternative, web3 storage, peer-to-peer storage, encrypted storage, data persistence',
};
