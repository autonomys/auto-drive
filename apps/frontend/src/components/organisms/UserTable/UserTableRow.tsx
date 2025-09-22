'use client';

import bytes from 'bytes';
import toast from 'react-hot-toast';
import { Copy } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { CreditsUpdateModal } from './CreditsUpdateModal';
import { SubscriptionInfoWithUser } from '@auto-drive/models';
import { UpdateRoleModal } from './UpdateRoleModal';
import { useUserStore } from 'globalStates/user';
import {
  TableBodyCell,
  TableBodyRow,
} from '@/components/molecules/Table/TableBody';
import { Button } from '@auto-drive/ui';
import { shortenString } from 'utils/misc';
import { handleEnterOrSpace } from 'utils/eventHandler';

type UserTableRowProps = {
  subscriptionWithUser: SubscriptionInfoWithUser;
};

export const UserTableRow = ({ subscriptionWithUser }: UserTableRowProps) => {
  const user = useUserStore(({ user }) => user);
  const [isUpdateRoleOpen, setIsUpdateRoleOpen] = useState(false);
  const [isCreditsUpdateModalOpen, setIsCreditsUpdateModalOpen] =
    useState(false);

  const granularity =
    subscriptionWithUser.granularity.charAt(0).toUpperCase() +
    subscriptionWithUser.granularity.slice(1);

  const myHandle = useMemo(() => user?.publicId, [user?.publicId]);

  const copyToClipboard = useCallback(() => {
    if (!subscriptionWithUser.user.publicId) return;

    navigator.clipboard.writeText(subscriptionWithUser.user.publicId);
    toast.success('Copied to clipboard');
  }, [subscriptionWithUser.user.publicId]);

  return (
    <TableBodyRow>
      <CreditsUpdateModal
        onClose={() => setIsCreditsUpdateModalOpen(false)}
        userHandle={
          isCreditsUpdateModalOpen ? subscriptionWithUser.user.publicId : null
        }
      />
      <UpdateRoleModal
        userHandle={
          isUpdateRoleOpen ? subscriptionWithUser.user.publicId : null
        }
        onClose={() => setIsUpdateRoleOpen(false)}
      />
      <TableBodyCell>
        <div
          role='button'
          tabIndex={0}
          onKeyDown={handleEnterOrSpace(copyToClipboard)}
          className='text-foreground-hover flex cursor-pointer items-center gap-2 text-sm transition-colors duration-200 hover:text-blue-500'
          onClick={copyToClipboard}
        >
          {shortenString(subscriptionWithUser.user.publicId!, 16)}{' '}
          <Copy size={16} />
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='text-foreground-hover text-sm'>
          {subscriptionWithUser.user.oauthProvider}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='text-foreground-hover flex items-center gap-2 text-sm'>
          {subscriptionWithUser.user.role}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='text-foreground-hover text-sm'>{granularity}</div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='text-foreground-hover text-sm'>
          {bytes(Number(subscriptionWithUser.uploadLimit), {
            unitSeparator: ' ',
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='text-foreground-hover text-sm'>
          {bytes(Number(subscriptionWithUser.pendingUploadCredits || 0), {
            unitSeparator: ' ',
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='text-foreground-hover text-sm'>
          {bytes(Number(subscriptionWithUser.downloadLimit), {
            unitSeparator: ' ',
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='text-foreground-hover text-sm'>
          {bytes(Number(subscriptionWithUser.pendingDownloadCredits || 0), {
            unitSeparator: ' ',
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='flex flex-col justify-end gap-2'>
          <Button
            variant='lightAccent'
            className='inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'
            onClick={() => {
              setIsCreditsUpdateModalOpen(true);
            }}
          >
            Update plan
          </Button>
          <Button
            variant='lightAccent'
            className='inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
            onClick={() => {
              setIsUpdateRoleOpen(true);
            }}
            disabled={myHandle === subscriptionWithUser.user.publicId}
          >
            Update role
          </Button>
        </div>
      </TableBodyCell>
    </TableBodyRow>
  );
};
