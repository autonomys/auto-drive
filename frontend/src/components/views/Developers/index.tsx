'use client';

import { ApiKeysTable } from '../../organisms/ApiKeysTable';
import { ApiKeyWithoutSecret } from '@auto-drive/models';

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
