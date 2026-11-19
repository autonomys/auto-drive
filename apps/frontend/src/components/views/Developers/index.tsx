'use client';

import { useRouter } from 'next/navigation';
import { ApiKeysTable } from '../../organisms/ApiKeysTable';
import { OrganizationApiKeys } from '../../organisms/OrganizationApiKeys';
import { ApiKeyWithoutSecret } from '@auto-drive/models';
import { AuthService } from 'services/auth/auth';
import { useUserStore } from 'globalStates/user';

export const Developers = ({
  apiKeys,
  newKeyName,
}: {
  apiKeys: ApiKeyWithoutSecret[];
  newKeyName?: string;
}) => {
  const router = useRouter();
  const account = useUserStore(({ account }) => account);

  return (
    <div>
      <span className='mb-4 text-2xl font-bold'>API Keys</span>
      <div className='flex flex-col gap-2 p-2'>
        <ApiKeysTable
          apiKeys={apiKeys}
          newKeyName={newKeyName}
          createKey={AuthService.generateApiKey}
          deleteKey={AuthService.deleteApiKey}
          // Re-renders the server page, which lists the keys again.
          onChanged={() => router.refresh()}
        />
      </div>
      {account?.isPartner && (
        <>
          <span className='mb-4 text-2xl font-bold'>Organization API Keys</span>
          <div className='flex flex-col gap-2 p-2'>
            <OrganizationApiKeys organizationId={account.organizationId} />
          </div>
        </>
      )}
    </div>
  );
};
