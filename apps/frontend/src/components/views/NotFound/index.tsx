// Start of Selection
'use client';

import { XIcon } from 'lucide-react';
import { DiscordIcon } from '@/components/icons/DiscordIcon';
import { EXTERNAL_ROUTES, ROUTES } from 'constants/routes';
import { InternalLink } from '@/components/atoms/InternalLink';
import { Button } from '@/components/atoms/Button';

export const NotFound = () => {
  return (
    <div className='p-8 text-center'>
      <h1 className='mb-4 text-2xl font-bold'>oops.</h1>
      <p className='mb-4'>
        Oops! Looks like the route you&apos;re looking for doesn&apos;t exist.
      </p>
      <p className='mb-4 flex items-center justify-center'>
        If you think this is an error, please contact us at{' '}
        <a
          href={EXTERNAL_ROUTES.social.discord}
          target='_blank'
          rel='noreferrer'
          className='pl-[8px]'
        >
          <DiscordIcon />
        </a>{' '}
        or{' '}
        <a
          href={EXTERNAL_ROUTES.social.twitter}
          target='_blank'
          rel='noreferrer'
        >
          <XIcon />
        </a>
      </p>
      <InternalLink href={ROUTES.drive()}>
        <Button variant='lightAccent'>Go to home</Button>
      </InternalLink>
    </div>
  );
};
