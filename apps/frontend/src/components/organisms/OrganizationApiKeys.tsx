'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNetwork } from 'contexts/network';
import { ApiKeysTable } from './ApiKeysTable';

/**
 * A partner organization's API keys. The backend says whether the caller may
 * create and delete them.
 */
export const OrganizationApiKeys = ({
  organizationId,
}: {
  organizationId: string;
}) => {
  const { api, network } = useNetwork();
  const queryClient = useQueryClient();

  const queryKey = ['organizationApiKeys', network.id, organizationId];
  const { data, isError } = useQuery({
    queryKey,
    queryFn: () => api.getOrganizationApiKeys(organizationId),
  });

  return (
    <div className='flex flex-col'>
      <p className='mb-4 text-sm text-gray-500'>
        These keys belong to the organization rather than to any one member.
        They upload to the partner account, and files uploaded with them are
        managed through the key rather than shown in members&apos; drives.
        {data &&
          !data.canCreate &&
          ' Only organization admins can create them.'}
      </p>
      {isError && !data ? (
        <p className='text-sm text-gray-500'>
          Failed to load the organization&apos;s API keys.
        </p>
      ) : (
        <ApiKeysTable
          apiKeys={data?.apiKeys}
          createKey={
            data?.canCreate
              ? (input) => api.createOrganizationApiKey(organizationId, input)
              : undefined
          }
          deleteKey={
            data?.canRevoke
              ? (apiKeyId) =>
                  api.revokeOrganizationApiKey(organizationId, apiKeyId)
              : undefined
          }
          onChanged={() => queryClient.invalidateQueries({ queryKey })}
        />
      )}
    </div>
  );
};
