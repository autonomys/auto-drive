'use client';

import { ApiKeysTable } from '../../components/ApiKeysTable';
import { ApiKeyWithoutSecret } from '../../models/ApiKey';

export const Developers = ({ apiKeys }: { apiKeys: ApiKeyWithoutSecret[] }) => {
  return (
    <div>
      <span className='mb-4 text-2xl font-bold'>API Keys</span>
      <div className='flex flex-col gap-2 p-2'>
        <ApiKeysTable apiKeys={apiKeys} />
      </div>
    </div>
  );
};
