import { Metadata, type Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { getNoFlashScript } from '@auto-drive/ui';
import NextTopLoader from 'nextjs-toploader';
import { Toaster } from 'react-hot-toast';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'Auto Drive',
  description:
    'Store, share, and download your files securely with Autonomys Network decentralized permanent storage.',
  keywords: [
    'autonomys',
    'auto-drive',
    'decentralized storage',
    'permanent storage',
    'autonomys network',
    'file storage',
    'file sharing',
    'secure storage',
    'blockchain storage',
    'distributed storage',
    'cloud storage alternative',
    'web3 storage',
    'peer-to-peer storage',
    'encrypted storage',
    'data persistence',
  ],
  icons: {
    icon: [
      {
        media: '(prefers-color-scheme: light)',
        url: '/favicon.ico',
        href: '/favicon.ico',
      },
      {
        media: '(prefers-color-scheme: dark)',
        url: '/favicon-dark.ico',
        href: '/favicon-dark.ico',
      },
    ],
  },
  openGraph: {
    title: 'Auto Drive',
    description:
      'Store, share, and download your files securely with Autonomys Network decentralized permanent storage.',
    images: ['https://ai3.storage/share.png'],
    url: 'https://ai3.storage/',
    siteName: 'Auto Drive',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Auto Drive',
    description:
      'Store, share, and download your files securely with Autonomys Network decentralized permanent storage.',
    images: ['https://ai3.storage/share.png'],
    site: '@AutonomysNet',
    creator: '@AutonomysLabs',
  },
  alternates: {
    canonical: 'https://ai3.storage/',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: getNoFlashScript() }} />
        <NextTopLoader color='#1949D2' height={2} showSpinner={false} />
        {children}
        <Toaster position='top-center' />
      </body>
    </html>
  );
}
