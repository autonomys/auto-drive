'use client';

import { LoaderCircle } from 'lucide-react';
import { type LiteralUnion, signIn } from 'next-auth/react';
import { useCallback, useMemo, useState } from 'react';
import { GoogleIcon } from '../components/common/GoogleIcon';
import { DiscordIcon } from '../components/common/DiscordIcon';
import type { BuiltInProviderType } from 'next-auth/providers/index';

export default function App() {
  const [isLoading, setIsLoading] = useState(false);

  const handleAuth = useCallback(
    (provider: LiteralUnion<BuiltInProviderType>) => () => {
      setIsLoading(true);
      signIn(provider);
    },
    [],
  );

  const handleGoogleAuth = useMemo(() => handleAuth('google'), [handleAuth]);
  const handleDiscordAuth = useMemo(() => handleAuth('discord'), [handleAuth]);

  return (
    <div className='flex min-h-screen items-center justify-center bg-gradient-to-r from-blue-500 to-purple-600'>
      <div className='w-full max-w-md rounded-lg bg-white p-8 shadow-2xl'>
        <h1 className='mb-6 text-center text-3xl font-bold text-gray-800'>
          Welcome to Auto-Drive
        </h1>
        <p className='mb-8 text-center text-gray-600'>
          Sign in with your Google account to start using our decentralized
          storage service
        </p>
        <div className='flex flex-col items-center justify-center gap-4'>
          <button
            onClick={handleGoogleAuth}
            disabled={isLoading}
            className='flex w-full max-w-xs transform items-center justify-center rounded-full border-2 border-transparent bg-black px-6 py-3 font-bold text-white transition duration-300 ease-in-out hover:-translate-y-1 hover:scale-105 hover:border-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2'
            aria-label='Sign in with Google'
          >
            {isLoading ? (
              <div className='flex items-center justify-center'>
                <LoaderCircle className='mr-2 h-4 w-4 animate-spin' />
                Redirecting...
              </div>
            ) : (
              <>
                <GoogleIcon />
                Sign in with Google
              </>
            )}
          </button>
          <button
            onClick={handleDiscordAuth}
            disabled={isLoading}
            className='flex w-full max-w-xs transform items-center justify-center rounded-full border-2 border-transparent bg-black px-6 py-3 font-bold text-white transition duration-300 ease-in-out hover:-translate-y-1 hover:scale-105 hover:border-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2'
            aria-label='Sign in with Google'
          >
            {isLoading ? (
              <div className='flex items-center justify-center'>
                <LoaderCircle className='mr-2 h-4 w-4 animate-spin' />
                Redirecting...
              </div>
            ) : (
              <>
                <DiscordIcon />
                Sign in with Discord
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
