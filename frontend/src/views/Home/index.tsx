'use client';

import Link from 'next/link';
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
            Auto Drive
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
      <h2 className="text-center text-4xl font-bold text-backgroundDarker my-8">
        Upload Once, Access Forever.
      </h2>
      <div className='mt-5 flex min-h-[50vh] w-[90%] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl rounded-xl bg-white py-8 md:w-[60%] md:flex-row md:gap-0 md:py-0'>
        <div className='flex h-full w-full grow flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <Image
            className='w-full rounded-3xl border-2 border-gray-200'
            src='/images/drag-drop-or-select-files-folders.png.png'
            alt='Drag and drop files and folders'
            width={420}
            height={272}
          />
        </div>
        <div className='flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <h1 className='margin-0 bg-gradient-to-b from-backgroundDarkest to-backgroundDark bg-clip-text text-4xl font-semibold text-transparent'>
            Upload Files & Folders
          </h1>
          <p className='text-gray max-w-[75%] text-center text-lg font-light'>
            Upload files and folders to Autonomys Network decentralized permanent storage, by simply dragging and dropping them into the upload area. Or select files and folders from your computer.
          </p>
        </div>
      </div>
      <h2 className="text-center text-4xl font-bold text-backgroundDarker my-8">
        Your Drive into Permanent Decentralized Storage.
      </h2>
      <div className='mt-5 flex min-h-[50vh] w-[90%] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl rounded-xl bg-white py-8 md:w-[60%] md:flex-row md:gap-0 md:py-0'>
        <div className='flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <h1 className='margin-0 bg-gradient-to-b from-backgroundDarkest to-backgroundDark bg-clip-text text-4xl font-semibold text-transparent'>
            Secure End-to-End Encryption (E2EE)
          </h1>
          <p className='text-gray max-w-[75%] text-center text-lg font-light leading-relaxed'>
            Secure your data with optional end-to-end encryption on Autonomys Network. Choose between setting a global encryption key for all files, customizing keys per file, or uploading without encryption - putting you in complete control of your data security.
          </p>
        </div>
        <div className='flex h-full w-full grow flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <Image
            className='w-full rounded-3xl border-2 border-gray-200'
            src='/images/upload-with-encryption-or-without.png'
            alt='Upload with encryption or without'
            width={420}
            height={272}
          />
        </div>
      </div>
      <h2 className="text-center text-4xl font-bold text-backgroundDarker my-8">
        Seamless Integration & Developer-Friendly
      </h2>
      <div className='mt-5 flex min-h-[50vh] w-[90%] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl rounded-xl bg-white py-8 md:w-[60%] md:flex-row md:gap-0 md:py-0'>
        <div className='flex h-full w-full grow flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <Image
            className='w-full rounded-3xl border-2 border-gray-200'
            src='/images/api-support.png'
            alt='API Support'
            width={420}
            height={272}
          />
        </div>
        <div className='flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <h1 className='margin-0 bg-gradient-to-b from-backgroundDarkest to-backgroundDark bg-clip-text text-4xl font-semibold text-transparent'>
            Create API Keys
          </h1>
          <p className='text-gray max-w-[75%] text-center text-lg font-light'>
            Create API keys to access Autonomys Network decentralized permanent storage, through our API.
          </p>
        </div>
      </div>
      <h2 className="text-center text-4xl font-bold text-backgroundDarker my-8">
        TypeScript & JavaScript Support with Full Type Safety
      </h2>
      <div className='mt-5 flex min-h-[50vh] w-[90%] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl rounded-xl bg-white py-8 md:w-[60%] md:flex-row md:gap-0 md:py-0'>
        <div className='flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <h1 className='margin-0 bg-gradient-to-b from-backgroundDarkest to-backgroundDark bg-clip-text text-4xl font-semibold text-transparent'>
            @autonomys/auto-drive
          </h1>
          <p className='text-gray max-w-[75%] text-center text-lg font-light'>
            Implement Auto-Drive&apos;s powerful permanent decentralized storage capabilities into your own applications using our official NPM package. Get started quickly with a familiar JavaScript/TypeScript interface and comprehensive documentation.
            <br />
            <br />
            <Link
              href='https://www.npmjs.com/package/@autonomys/auto-drive'
              className='text-accent'
              target='_blank'
              rel='noreferrer'
            >
              npm install auto-drive
            </Link>
            <br />
            <Link
              href='https://www.npmjs.com/package/@autonomys/auto-drive'
              className='text-accent'
              target='_blank'
              rel='noreferrer'
            >
              yarn add auto-drive
            </Link>
          </p>
        </div>
        <div className='flex h-full w-full grow flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <Link
            href='https://www.npmjs.com/package/@autonomys/auto-drive'
            className='text-accent'
            target='_blank'
            rel='noreferrer'
          >
            <Image
              className='w-full rounded-3xl border-2 border-gray-200'
              src='/images/auto-drive-npm.png'
              alt='Auto-Drive NPM Package'
              width={420}
              height={272}
            />
          </Link>
        </div>
      </div>
      <h2 className="text-center text-4xl font-bold text-backgroundDarker my-8">
        Scalable Data Structure for Decentralized Storage
      </h2>
      <div className='mt-5 flex min-h-[50vh] w-[90%] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl rounded-xl bg-white py-8 md:w-[60%] md:flex-row md:gap-0 md:py-0'>
        <div className='flex h-full w-full grow flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <Link
            href='https://www.npmjs.com/package/@autonomys/auto-dag-data'
            className='text-accent'
            target='_blank'
            rel='noreferrer'
          >
            <Image
              className='w-full rounded-3xl border-2 border-gray-200'
              src='/images/auto-dag-data.png'
              alt='Auto-DAG Data Structure'
              width={420}
              height={272}
            />
          </Link>
        </div>
        <div className='flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <h1 className='margin-0 bg-gradient-to-b from-backgroundDarkest to-backgroundDark bg-clip-text text-4xl font-semibold text-transparent'>
            Auto-DAG Data Structure
          </h1>
          <p className='text-gray max-w-[75%] text-center text-lg font-light leading-relaxed'>
            Autonomys Network uses the Auto-DAG data structure, which store your data on chain in small chunks to fit the block size limit of Autonomys Network and to ensure the integrity and authenticity of your data.
          </p>
        </div>
      </div>
      <h2 className="text-center text-4xl font-bold text-backgroundDarker my-8">
        Join Us Today and Experience the Future of Storage!
      </h2>
      <div className='mt-5 flex min-h-[50vh] w-[90%] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl rounded-xl bg-white py-8 md:w-[60%] md:flex-row md:gap-0 md:py-0'>
        <div className='flex h-full w-full grow flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <Image
            className='w-full rounded-3xl border-2 border-gray-200'
            src='/preview.png'
            alt='Home Hero'
            width={420}
            height={272}
          />
        </div>
        <div className='flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4'>
          <h1 className='margin-0 bg-gradient-to-b from-backgroundDarkest to-backgroundDark bg-clip-text text-4xl font-semibold text-transparent'>
            Auto Drive
          </h1>
          <p className='text-gray max-w-[75%] text-center text-lg font-light'>
            Sign in now to store, share, and download your files securely with Autonomys Network decentralized permanent storage.
          </p>
          <SigningInButtons />
        </div>
      </div>
      <Footer />
    </div>
  );
};
