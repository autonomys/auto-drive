'use client';

import { useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ROUTES } from '@auto-drive/ui';
import { useNetwork } from '@/contexts/network';
import { organizationOverviewKey } from '@/hooks/useOrganization';
import { FileActionButtons, FileTable } from '@/components/organisms/FileTable';
import {
  Fetcher,
  useFileTableState,
} from '@/components/organisms/FileTable/state';
import { OrganizationApiKeys } from '@/components/organisms/OrganizationApiKeys';
import { UsageReportView } from '@/components/views/UsageReport';
import { formatStorageSize } from '@/utils/number';
import { OrganizationPage } from './OrganizationPage';
import { OrganizationCredits } from './OrganizationCredits';
import { OrganizationMembers } from './OrganizationMembers';

export const OrganizationOverviewView = () => {
  const { network } = useNetwork();
  const queryClient = useQueryClient();

  return (
    <OrganizationPage title='Overview'>
      {(overview) => (
        <>
          <OrganizationCredits overview={overview} />
          <OrganizationMembers
            overview={overview}
            onChanged={() =>
              queryClient.invalidateQueries({
                queryKey: organizationOverviewKey(network.id, overview.id),
              })
            }
          />
        </>
      )}
    </OrganizationPage>
  );
};

const OrganizationFileTable = ({
  organizationId,
}: {
  organizationId: string;
}) => {
  const { api } = useNetwork();
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);

  // Listed newest first; the table's sorting and search don't apply.
  const fetcher: Fetcher = useCallback(
    async (page, limit) => {
      const files = await api.getOrganizationFiles(
        organizationId,
        limit,
        page * limit,
      );
      return { objects: files.rows, total: files.totalCount };
    },
    [api, organizationId],
  );

  useEffect(() => {
    setObjects(null);
    setFetcher(fetcher);
  }, [fetcher, setFetcher, setObjects]);

  return (
    <FileTable
      actionButtons={[FileActionButtons.DOWNLOAD, FileActionButtons.REPORT]}
      sortable={false}
      noFilesPlaceholder={
        <p className='py-6 text-center text-sm text-gray-500'>
          Nothing has been uploaded with the organization&apos;s API keys yet.
        </p>
      }
    />
  );
};

export const OrganizationFilesView = () => {
  const { network } = useNetwork();

  return (
    <OrganizationPage
      title='Files'
      description={
        <>
          Files uploaded with the organization&apos;s{' '}
          <Link
            href={ROUTES.organizationApiKeys(network.id)}
            className='text-primary hover:underline'
          >
            API keys
          </Link>
          , newest first. Files members upload in the web app or with their own
          keys are in their own drives.
        </>
      }
    >
      {(overview) => <OrganizationFileTable organizationId={overview.id} />}
    </OrganizationPage>
  );
};

export const OrganizationUsageView = () => (
  <OrganizationPage
    title='Usage'
    description='Uploads, downloads and credits of the organization, by API key and customer reference.'
  >
    {(overview) => (
      <>
        <p className='text-sm'>
          Left now:{' '}
          <strong>
            {formatStorageSize(
              Number(overview.credits.purchasedBytesRemaining),
              2,
            )}
          </strong>{' '}
          purchased
          {Number(overview.credits.monthlyFreeUploadBytes) > 0 && (
            <>
              {' · '}
              <strong>
                {formatStorageSize(
                  Number(overview.credits.monthlyFreeBytesRemaining),
                  2,
                )}
              </strong>{' '}
              monthly free
            </>
          )}
          {overview.credits.oneTimeFreeGrantCount > 0 && (
            <>
              {' · '}
              <strong>
                {formatStorageSize(
                  Number(overview.credits.oneTimeFreeBytesRemaining),
                  2,
                )}
              </strong>{' '}
              one-time free
            </>
          )}
        </p>
        <UsageReportView accountId={overview.accountId} />
      </>
    )}
  </OrganizationPage>
);

export const OrganizationApiKeysView = () => (
  <OrganizationPage
    title='API keys'
    description='Keys for your integrations. They belong to the organization, so they keep working when people leave.'
  >
    {(overview) => <OrganizationApiKeys organizationId={overview.id} />}
  </OrganizationPage>
);
