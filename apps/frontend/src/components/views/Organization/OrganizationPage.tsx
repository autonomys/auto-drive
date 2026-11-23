'use client';

import { ReactNode } from 'react';
import { Loader } from 'lucide-react';
import { OrganizationOverview } from '@auto-drive/models';
import { useOrganization } from '@/hooks/useOrganization';
import { ROLE_LABEL } from '@/utils/organization';

/**
 * Frame of the organization pages: the organization's name over the page
 * title, and what to show while it loads or when the user is in no partner
 * organization.
 */
export const OrganizationPage = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: (overview: OrganizationOverview) => ReactNode;
}) => {
  const { organizationId, accountLoaded, overview, error } = useOrganization();

  if (accountLoaded && !organizationId) {
    return (
      <div className='flex flex-col gap-2 p-2'>
        <h1 className='text-2xl font-bold'>{title}</h1>
        <p className='text-sm text-gray-500'>
          You are not a member of a partner organization.
        </p>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6 p-2'>
      <div>
        {overview && (
          <p className='flex items-center gap-2 text-sm text-gray-500'>
            {overview.name}
            {overview.viewerRole && (
              <span className='rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300'>
                You are {ROLE_LABEL[overview.viewerRole].toLowerCase()}
              </span>
            )}
          </p>
        )}
        <h1 className='text-2xl font-bold'>{title}</h1>
        {description && (
          <p className='mt-1 text-sm text-gray-500'>{description}</p>
        )}
      </div>
      {overview ? (
        children(overview)
      ) : error ? (
        <p className='text-sm text-gray-500'>
          {error instanceof Error
            ? error.message
            : 'Failed to load your organization.'}
        </p>
      ) : (
        <div className='flex items-center justify-center py-8'>
          <Loader className='h-6 w-6 animate-spin' />
        </div>
      )}
    </div>
  );
};
