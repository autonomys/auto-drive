'use client';

import Footer from '../../components/Footer';
import { LandingHeader } from '../../components/common/LandingHeader';
import { SigningInButtons } from './SignInButtons';
import Image from 'next/image';

export const Home = () => {
  return (
    <div className='flex min-h-screen flex-col items-center justify-between gap-2 bg-gradient-to-b from-backgroundLight to-backgroundDark'>
      <LandingHeader />
      <div className='mt-5 flex min-h-[50vh] w-[90%] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl rounded-xl bg-white py-8 md:w-[60%] md:flex-row md:gap-0 md:py-0'>
        <div className='flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <h1 className='margin-0 bg-gradient-to-b from-backgroundDarkest to-backgroundDark bg-clip-text text-4xl font-semibold text-transparent'>
            Auto-Drive
          </h1>
          <p className='text-gray max-w-[75%] text-center text-lg font-light'>
            Store, share, and download your files securely with Autonomys
            Network decentralized permanent storage.
          </p>
          <SigningInButtons />
        </div>
        <div className='flex h-full w-full grow flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <Image
            className='w-full rounded-3xl border-2 border-gray-200'
            src='/preview.png'
            alt='Home Hero'
            width={420}
            height={272}
          />
        </div>
      </div>
      <Footer />
    </div>
  );
};
