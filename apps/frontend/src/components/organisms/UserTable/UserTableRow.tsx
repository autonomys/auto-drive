'use client';

import bytes from 'bytes';
import toast from 'react-hot-toast';
import { Copy } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { CreditsUpdateModal } from './CreditsUpdateModal';
import { AccountInfoWithUser } from '@auto-drive/models';
import { UpdateRoleModal } from './UpdateRoleModal';
import { useUserStore } from 'globalStates/user';
import {
  TableBodyCell,
  TableBodyRow,
} from '@/components/molecules/Table/TableBody';
import { shortenString } from 'utils/misc';
import { handleEnterOrSpace } from 'utils/eventHandler';

type UserTableRowProps = {
  accountWithUser: AccountInfoWithUser;
};

export const UserTableRow = ({ accountWithUser }: UserTableRowProps) => {
  const user = useUserStore(({ user }) => user);
  const [isUpdateRoleOpen, setIsUpdateRoleOpen] = useState(false);
  const [isCreditsUpdateModalOpen, setIsCreditsUpdateModalOpen] =
    useState(false);

  const granularity =
    accountWithUser.model.charAt(0).toUpperCase() +
    accountWithUser.model.slice(1);

  const myHandle = useMemo(() => user?.publicId, [user?.publicId]);

  const copyToClipboard = useCallback(() => {
    if (!accountWithUser.user.publicId) return;

    navigator.clipboard.writeText(accountWithUser.user.publicId);
    toast.success('Copied to clipboard');
  }, [accountWithUser.user.publicId]);

  return (
    <TableBodyRow>
      <CreditsUpdateModal
        onClose={() => setIsCreditsUpdateModalOpen(false)}
        userHandle={
          isCreditsUpdateModalOpen ? accountWithUser.user.publicId : null
        }
      />
      <UpdateRoleModal
        userHandle={isUpdateRoleOpen ? accountWithUser.user.publicId : null}
        onClose={() => setIsUpdateRoleOpen(false)}
      />
      <TableBodyCell>
        <div
          role='button'
          tabIndex={0}
          onKeyDown={handleEnterOrSpace(copyToClipboard)}
          className='dark:text-darkBlack flex cursor-pointer items-center gap-2 text-sm text-black transition-colors duration-200 hover:text-blue-500'
          onClick={copyToClipboard}
        >
          {shortenString(accountWithUser.user.publicId!, 16)} <Copy size={16} />
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='dark:text-darkBlack text-sm text-black'>
          {accountWithUser.user.oauthProvider}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='dark:text-darkBlack flex items-center gap-2 text-sm text-black'>
          {accountWithUser.user.role}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='dark:text-darkBlack text-sm text-black'>
          {granularity}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='dark:text-darkBlack text-sm text-black'>
          {bytes(Number(accountWithUser.uploadLimit), {
            unitSeparator: ' ',
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='dark:text-darkBlack text-sm text-black'>
          {bytes(Number(accountWithUser.pendingUploadCredits || 0), {
            unitSeparator: ' ',
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='dark:text-darkBlack text-sm text-black'>
          {bytes(Number(accountWithUser.downloadLimit), {
            unitSeparator: ' ',
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='dark:text-darkBlack text-sm text-black'>
          {bytes(Number(accountWithUser.pendingDownloadCredits || 0), {
            unitSeparator: ' ',
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='flex flex-col justify-end gap-2'>
          <button
            className='inline-flex justify-center rounded-md border border-transparent bg-blue-100 px-4 py-2 text-sm font-medium text-blue-900 hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'
            onClick={() => {
              setIsCreditsUpdateModalOpen(true);
            }}
          >
            Update plan
          </button>
          <button
            className='inline-flex justify-center rounded-md border border-transparent bg-blue-100 px-4 py-2 text-sm font-medium text-blue-900 hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
            onClick={() => {
              setIsUpdateRoleOpen(true);
            }}
            disabled={myHandle === accountWithUser.user.publicId}
          >
            Update role
          </button>
        </div>
      </TableBodyCell>
    </TableBodyRow>
  );
};
