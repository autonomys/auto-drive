'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { defaultNetworkId, ROUTES } from '@auto-drive/ui';

type ErrorPageProps = {
  error: Error & { digest?: string };
};

export default function ErrorPage({ error }: ErrorPageProps) {
  const router = useRouter();

  return (
    <div className='flex min-h-[calc(100vh-10rem)] items-center justify-center p-8'>
      <div className='w-full max-w-xl text-center'>
        <h1 className='text-4xl font-bold'>Something went wrong</h1>
        <p className='mt-4 text-base text-muted-foreground md:text-lg'>
          An unexpected error occurred while loading this page. If the problem
          persists, please contact support.
        </p>
        {error?.message ? (
          <p className='mt-5 rounded bg-muted p-4 text-left text-sm leading-relaxed'>
            {error.message}
            {error?.digest ? (
              <span className='mt-2 block opacity-70'>
                Error ID: {error.digest}
              </span>
            ) : null}
          </p>
        ) : null}
        <div className='mt-8 flex items-center justify-center gap-4'>
          <button
            type='button'
            onClick={() => window.location.reload()}
            className='rounded-md bg-primary px-5 py-3 text-base font-medium text-primary-foreground hover:opacity-90'
          >
            Try again
          </button>
          <button
            type='button'
            onClick={() => router.replace(ROUTES.globalFeed(defaultNetworkId))}
            className='rounded-md border px-5 py-3 text-base hover:bg-muted'
          >
            Go to Drive
          </button>
        </div>
      </div>
    </div>
  );
}
