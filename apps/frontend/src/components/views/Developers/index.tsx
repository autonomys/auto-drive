'use client';

import { APIKeysTable } from '../../organisms/ApiKeysTable';
import { APIKeyWithoutSecret } from '@auto-drive/models';

export const Developers = ({ apiKeys }: { apiKeys: APIKeyWithoutSecret[] }) => {
  return (
    <div>
      <span className='mb-4 text-2xl font-bold'>API Keys</span>
      <div className='flex flex-col gap-2 p-2'>
        <APIKeysTable apiKeys={apiKeys} />
      </div>
    </div>
  );
};
