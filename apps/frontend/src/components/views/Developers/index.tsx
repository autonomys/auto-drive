'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@auto-drive/ui';
import { ApiKeysTable } from '../../organisms/ApiKeysTable';
import { ApiKeyWithoutSecret } from '@auto-drive/models';
import { AuthService } from 'services/auth/auth';
import { useNetwork } from '@/contexts/network';
import { useOrganization } from '@/hooks/useOrganization';

export const Developers = ({
  apiKeys,
  newKeyName,
}: {
  apiKeys: ApiKeyWithoutSecret[];
  newKeyName?: string;
}) => {
  const router = useRouter();
  const { network } = useNetwork();
  const { organizationId, overview } = useOrganization();
  const organizationName = overview?.name ?? 'your organization';

  return (
    <div className='flex flex-col gap-4 p-2'>
      <div>
        <h1 className='text-2xl font-bold'>Your API keys</h1>
        <p className='mt-1 text-sm text-gray-500'>
          Keys that act as you: files uploaded with them are yours and appear in
          My Files.
        </p>
      </div>
      {organizationId && (
        <p className='rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200'>
          You are in {organizationName}, so uploads with these keys use its
          credits. For integrations, use the{' '}
          <Link
            href={ROUTES.organizationApiKeys(network.id)}
            className='font-medium underline'
          >
            organization&apos;s API keys
          </Link>
          , which keep working when people leave.
        </p>
      )}
      <ApiKeysTable
        apiKeys={apiKeys}
        newKeyName={newKeyName}
        createKey={AuthService.generateApiKey}
        deleteKey={AuthService.deleteApiKey}
        // Re-renders the server page, which lists the keys again.
        onChanged={() => router.refresh()}
      />
    </div>
  );
};
