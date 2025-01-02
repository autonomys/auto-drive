'use client';

import localFont from 'next/font/local';
import Footer from '../../components/Footer';
import { FAQ } from '../../components/FAQ';

const geistSans = localFont({
  src: '../fonts/GeistMonoVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});

export default function App() {
  return (
    <div
      className={`from-backgroundLight to-backgroundDark flex min-h-screen flex-col items-center justify-between bg-gradient-to-b ${geistSans.variable}`}
    >
      <FAQ />
      <Footer />
    </div>
  );
}
