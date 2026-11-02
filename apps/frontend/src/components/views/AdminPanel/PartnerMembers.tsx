'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Loader, Users } from 'lucide-react';
import { Button } from '@auto-drive/ui';
import {
  AdminAccountDetails,
  OrganizationMembershipChange,
  OrganizationRole,
  OrganizationWithMembers,
} from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { Table } from '@/components/molecules/Table';
import {
  TableHead,
  TableHeadCell,
  TableHeadRow,
} from '@/components/molecules/Table/TableHead';
import {
  TableBody,
  TableBodyCell,
  TableBodyRow,
} from '@/components/molecules/Table/TableBody';
import { CopiableText } from '@/components/atoms/CopiableText';
import { formatDate } from '@/utils/time';

const ROLE_LABEL: Record<OrganizationRole, string> = {
  [OrganizationRole.Admin]: 'Organization admin',
  [OrganizationRole.Member]: 'Member',
};

const describeChange = (
  change: OrganizationMembershipChange,
  organizationId: string,
): string => {
  if (change.fromOrganizationId === change.toOrganizationId) {
    return `Role changed to ${change.role ? ROLE_LABEL[change.role] : '—'}`;
  }
  if (change.toOrganizationId === organizationId) {
    return `Added as ${change.role ? ROLE_LABEL[change.role] : '—'}`;
  }
  return 'Removed, returned to their personal organization';
};

/**
 * Members of a partner organization: add, change role and remove. The
 * backend refuses a move while the user holds purchased credits or has
 * unresolved payments, and its message is shown as is.
 */
export const PartnerMembers = ({
  account,
  organization,
  onChanged,
}: {
  account: AdminAccountDetails;
  organization: OrganizationWithMembers;
  onChanged: () => void;
}) => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();
  const [publicId, setPublicId] = useState('');
  const [role, setRole] = useState<OrganizationRole>(OrganizationRole.Member);

  const changesKey = ['adminMembershipChanges', organization.id];
  const { data: changes, isLoading: isLoadingChanges } = useQuery({
    queryKey: changesKey,
    queryFn: () => api.getOrganizationMembershipChanges(organization.id),
  });

  const afterChange = (message: string) => {
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: changesKey });
    onChanged();
  };

  const { mutate: addMember, isPending: isAdding } = useMutation({
    mutationFn: () =>
      api.addOrganizationMember(organization.id, publicId.trim(), role),
    onSuccess: () => {
      setPublicId('');
      afterChange('Member added');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const { mutate: changeRole } = useMutation({
    mutationFn: (args: { publicId: string; role: OrganizationRole }) =>
      api.changeOrganizationMemberRole(
        organization.id,
        args.publicId,
        args.role,
      ),
    onSuccess: () => afterChange('Role changed'),
    onError: (error: Error) => toast.error(error.message),
  });

  const { mutate: removeMember, variables: removingId } = useMutation({
    mutationFn: (memberPublicId: string) =>
      api.removeOrganizationMember(organization.id, memberPublicId),
    onSuccess: () => afterChange('Member removed'),
    onError: (error: Error) => toast.error(error.message),
  });

  const usernames = new Map(
    account.members.map((m) => [m.publicId, m.oauthUsername]),
  );

  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h2 className='mb-1 flex items-center gap-2 text-lg font-semibold'>
          <Users className='h-5 w-5' />
          Members of {organization.name}
        </h2>
        <p className='mb-4 text-sm text-gray-500'>
          Adding a user moves them out of their personal organization. Their
          earlier usage stays on their personal account, and removing them
          returns them to it.
        </p>

        <form
          className='mb-4 flex flex-wrap gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            if (publicId.trim()) addMember();
          }}
        >
          <input
            type='text'
            value={publicId}
            onChange={(e) => setPublicId(e.target.value)}
            placeholder='User public ID'
            className='min-w-64 flex-1 rounded-md border border-gray-300 bg-background px-3 py-2 font-mono text-sm'
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OrganizationRole)}
            className='rounded-md border border-gray-300 bg-background px-3 py-2 text-sm'
          >
            {Object.values(OrganizationRole).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <Button
            type='submit'
            variant='primary'
            disabled={isAdding || !publicId.trim()}
          >
            {isAdding ? 'Adding…' : 'Add member'}
          </Button>
        </form>

        <Table className='min-w-full'>
          <TableHead>
            <TableHeadRow>
              <TableHeadCell>Public ID</TableHeadCell>
              <TableHeadCell>Username</TableHeadCell>
              <TableHeadCell>Role</TableHeadCell>
              <TableHeadCell>{''}</TableHeadCell>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {organization.members.map((member) => (
              <TableBodyRow key={member.publicId}>
                <TableBodyCell>
                  <CopiableText
                    text={member.publicId}
                    className='break-all font-mono text-sm'
                  />
                </TableBodyCell>
                <TableBodyCell>
                  {usernames.get(member.publicId) ?? '—'}
                </TableBodyCell>
                <TableBodyCell>
                  <select
                    value={member.role}
                    onChange={(e) =>
                      changeRole({
                        publicId: member.publicId,
                        role: e.target.value as OrganizationRole,
                      })
                    }
                    className='rounded-md border border-gray-300 bg-background px-2 py-1 text-sm'
                  >
                    {Object.values(OrganizationRole).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </TableBodyCell>
                <TableBodyCell>
                  <Button
                    variant='lightDanger'
                    size='sm'
                    disabled={removingId === member.publicId}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${member.publicId} from ${organization.name}?`,
                        )
                      ) {
                        removeMember(member.publicId);
                      }
                    }}
                  >
                    Remove
                  </Button>
                </TableBodyCell>
              </TableBodyRow>
            ))}
            {organization.members.length === 0 && (
              <TableBodyRow>
                <TableBodyCell
                  colSpan={4}
                  className='py-6 text-center text-gray-500'
                >
                  No members
                </TableBodyCell>
              </TableBodyRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h2 className='mb-4 flex items-center gap-2 text-lg font-semibold'>
          <History className='h-5 w-5' />
          Membership Changes
        </h2>
        {isLoadingChanges ? (
          <div className='flex items-center justify-center py-4'>
            <Loader className='h-5 w-5 animate-spin' />
          </div>
        ) : (
          <Table className='min-w-full'>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>When</TableHeadCell>
                <TableHeadCell>User</TableHeadCell>
                <TableHeadCell>Change</TableHeadCell>
                <TableHeadCell>By</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {changes?.map((change) => (
                <TableBodyRow key={change.id}>
                  <TableBodyCell>{formatDate(change.createdAt)}</TableBodyCell>
                  <TableBodyCell>
                    <CopiableText
                      text={change.publicId}
                      className='break-all font-mono text-sm'
                    />
                  </TableBodyCell>
                  <TableBodyCell>
                    {describeChange(change, organization.id)}
                  </TableBodyCell>
                  <TableBodyCell>
                    <CopiableText
                      text={change.actor}
                      className='break-all font-mono text-sm'
                    />
                  </TableBodyCell>
                </TableBodyRow>
              ))}
              {changes?.length === 0 && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={4}
                    className='py-6 text-center text-gray-500'
                  >
                    No changes yet
                  </TableBodyCell>
                </TableBodyRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};
