'use client';

import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { useUserStore } from '../../states/user';
import { DefaultPasswordModal } from '../../components/DefaultPasswordModal';
import { ApiKeysTable } from '../../components/ApiKeysTable';
import { Button } from '../../components/common/Button';
import { signOut } from 'next-auth/react';
import { ApiKeyWithoutSecret } from '../../models/ApiKey';
import { LogOut } from 'lucide-react';

export const Profile = ({ apiKeys }: { apiKeys: ApiKeyWithoutSecret[] }) => {
  const [isDefaultPasswordModalOpen, setIsDefaultPasswordModalOpen] =
    useState<boolean>(false);

  const publicId = useUserStore((s) => s.user?.publicId);

  const copyPublicId = useCallback(() => {
    if (!publicId) return;
    navigator.clipboard.writeText(publicId);
    toast.success('Copied to clipboard');
  }, [publicId]);

  const openDefaultPasswordModal = useCallback(() => {
    setIsDefaultPasswordModalOpen(true);
  }, []);

  const closeDefaultPasswordModal = useCallback(() => {
    setIsDefaultPasswordModalOpen(false);
  }, []);

  console.log(JSON.stringify(apiKeys, null, 2));

  return (
    <div>
      <DefaultPasswordModal
        isOpen={isDefaultPasswordModalOpen}
        onClose={closeDefaultPasswordModal}
      />
      <span className='mb-4 text-2xl font-bold'>API Keys</span>
      <div className='flex flex-col gap-2 p-2'>
        <ApiKeysTable apiKeys={apiKeys} />
      </div>
      <div className='flex flex-col gap-4 p-2'>
        <span className='mb-4 text-2xl font-bold'>My Account</span>
        <div className='flex gap-2'>
          <span>
            <Button
              variant='lightAccent'
              className='text-sm'
              onClick={openDefaultPasswordModal}
            >
              Update default password
            </Button>
          </span>
          <span>
            <Button
              variant='lightAccent'
              className='text-sm'
              onClick={copyPublicId}
            >
              Copy Public ID
            </Button>
          </span>
        </div>
        <div className='flex gap-2'>
          <span>
            <Button
              variant='lightDanger'
              className='flex items-center gap-2 text-sm'
              onClick={() => signOut()}
            >
              Log out
              <LogOut className='h-4 w-4' />
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
};