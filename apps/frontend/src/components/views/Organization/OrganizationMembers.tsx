'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { Button } from '@auto-drive/ui';
import {
  OrganizationMemberDetails,
  OrganizationOverview,
  OrganizationRole,
} from '@auto-drive/models';
import { useNetwork } from '@/contexts/network';
import { useUserStore } from '@/globalStates/user';
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
import { formatCid } from '@/utils/table';
import { formatDate } from '@/utils/time';
import { describeMembershipChange, ROLE_LABEL } from '@/utils/organization';
import { PendingInvitations } from './PendingInvitations';

const MemberName = ({
  member,
  isYou,
}: {
  member: OrganizationMemberDetails;
  isYou: boolean;
}) => (
  <span className='flex flex-col'>
    <span className='flex items-center gap-2'>
      {member.username ?? <span className='text-gray-500'>Unnamed</span>}
      {isYou && (
        <span className='rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400'>
          You
        </span>
      )}
    </span>
    {member.provider && (
      <span className='text-xs text-gray-500'>{member.provider}</span>
    )}
  </span>
);

/**
 * The organization's members. Its admins invite users, change roles and
 * remove members; everyone else sees who is in it.
 */
export const OrganizationMembers = ({
  overview,
  onChanged,
}: {
  overview: OrganizationOverview;
  onChanged: () => void;
}) => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();
  const viewerPublicId = useUserStore((state) => state.user?.publicId);
  const [publicId, setPublicId] = useState('');
  const [role, setRole] = useState<OrganizationRole>(OrganizationRole.Member);
  const { id: organizationId, canManageMembers } = overview;

  const invitationsKey = ['organizationInvitations', organizationId];
  const changesKey = ['organizationMembershipChanges', organizationId];

  const { mutate: invite, isPending: isInviting } = useMutation({
    mutationFn: (args: { publicId: string; role: OrganizationRole }) =>
      api.inviteOrganizationMember(organizationId, args.publicId, args.role),
    onSuccess: () => {
      setPublicId('');
      toast.success('Invitation sent');
      queryClient.invalidateQueries({ queryKey: invitationsKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const afterChange = (message: string) => {
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: changesKey });
    onChanged();
  };

  const { mutate: changeRole } = useMutation({
    mutationFn: (args: { publicId: string; role: OrganizationRole }) =>
      api.changeOrganizationMemberRole(
        organizationId,
        args.publicId,
        args.role,
      ),
    onSuccess: () => afterChange('Role changed'),
    onError: (error: Error) => toast.error(error.message),
  });

  const {
    mutate: removeMember,
    isPending: isRemoving,
    variables: removingId,
  } = useMutation({
    mutationFn: (memberPublicId: string) =>
      api.removeOrganizationMember(organizationId, memberPublicId),
    onSuccess: (_, memberPublicId) => {
      // Leaving the organization changes the viewer's own account.
      if (memberPublicId === viewerPublicId) {
        window.location.reload();
        return;
      }
      afterChange('Member removed');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const { data: changes } = useQuery({
    queryKey: changesKey,
    queryFn: () => api.getOrganizationMembershipChanges(organizationId),
    enabled: canManageMembers,
  });

  const names = new Map(
    overview.members.map((m) => [m.publicId, m.username ?? null]),
  );
  const nameOf = (id: string) => names.get(id) ?? formatCid(id);
  // The last admin can't be demoted or removed by the organization itself.
  const adminCount = overview.members.filter(
    (m) => m.role === OrganizationRole.Admin,
  ).length;
  const isLastAdmin = (member: OrganizationMemberDetails) =>
    member.role === OrganizationRole.Admin && adminCount === 1;

  return (
    <section className='space-y-6 rounded-lg border border-gray-200 bg-background p-6'>
      <div>
        <h2 className='flex items-center gap-2 text-lg font-semibold'>
          <Users className='h-5 w-5' />
          Members
        </h2>
        <p className='mt-1 text-sm text-gray-500'>
          Members upload with {overview.name}&apos;s credits, from the web app
          or their own API keys. Admins also manage members and organization API
          keys.
        </p>
      </div>

      {canManageMembers && (
        <form
          className='flex flex-col gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            const id = publicId.trim();
            if (id) invite({ publicId: id, role });
          }}
        >
          <div className='flex flex-wrap gap-2'>
            <input
              type='text'
              value={publicId}
              onChange={(e) => setPublicId(e.target.value)}
              placeholder='Public ID of the user to invite'
              aria-label='Public ID of the user to invite'
              className='min-w-64 flex-1 rounded-md border border-gray-300 bg-background px-3 py-2 font-mono text-sm'
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrganizationRole)}
              aria-label='Role'
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
              disabled={isInviting || !publicId.trim()}
            >
              {isInviting ? 'Inviting…' : 'Invite'}
            </Button>
          </div>
          <p className='text-xs text-gray-500'>
            They sign in to Auto Drive and copy their Public ID from Profile.
            They join once they accept the invitation, which lasts 14 days.
          </p>
        </form>
      )}

      <div className='overflow-x-auto'>
        <Table className='min-w-full'>
          <TableHead>
            <TableHeadRow>
              <TableHeadCell>Name</TableHeadCell>
              <TableHeadCell>Public ID</TableHeadCell>
              <TableHeadCell>Role</TableHeadCell>
              {canManageMembers && <TableHeadCell>{''}</TableHeadCell>}
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {overview.members.map((member) => {
              const isYou = member.publicId === viewerPublicId;
              const locked = isLastAdmin(member);
              return (
                <TableBodyRow key={member.publicId}>
                  <TableBodyCell>
                    <MemberName member={member} isYou={isYou} />
                  </TableBodyCell>
                  <TableBodyCell>
                    <CopiableText
                      text={member.publicId}
                      displayText={formatCid(member.publicId)}
                      className='font-mono text-sm'
                    />
                  </TableBodyCell>
                  <TableBodyCell>
                    {canManageMembers ? (
                      <select
                        value={member.role}
                        disabled={locked}
                        title={
                          locked
                            ? 'The only admin. Make another member an admin first.'
                            : undefined
                        }
                        aria-label={`Role of ${member.username ?? member.publicId}`}
                        onChange={(e) =>
                          changeRole({
                            publicId: member.publicId,
                            role: e.target.value as OrganizationRole,
                          })
                        }
                        className='rounded-md border border-gray-300 bg-background px-2 py-1 text-sm disabled:opacity-60'
                      >
                        {Object.values(OrganizationRole).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROLE_LABEL[member.role]
                    )}
                  </TableBodyCell>
                  {canManageMembers && (
                    <TableBodyCell className='text-right'>
                      <Button
                        variant='lightDanger'
                        size='sm'
                        disabled={
                          locked ||
                          (isRemoving && removingId === member.publicId)
                        }
                        title={
                          locked
                            ? 'The only admin. Make another member an admin first.'
                            : undefined
                        }
                        onClick={() => {
                          const message = isYou
                            ? `Leave ${overview.name}? You return to your personal account.`
                            : `Remove ${member.username ?? member.publicId} from ${overview.name}? They return to their personal account, and their files stay theirs.`;
                          if (window.confirm(message)) {
                            removeMember(member.publicId);
                          }
                        }}
                      >
                        {isYou ? 'Leave' : 'Remove'}
                      </Button>
                    </TableBodyCell>
                  )}
                </TableBodyRow>
              );
            })}
            {overview.members.length === 0 && (
              <TableBodyRow>
                <TableBodyCell
                  colSpan={canManageMembers ? 4 : 3}
                  className='py-6 text-center text-gray-500'
                >
                  No members
                </TableBodyCell>
              </TableBodyRow>
            )}
          </TableBody>
        </Table>
      </div>

      {canManageMembers && (
        <PendingInvitations
          organizationId={organizationId}
          queryKey={invitationsKey}
        />
      )}

      {canManageMembers && changes && changes.length > 0 && (
        <div>
          <h3 className='mb-3 text-sm font-medium uppercase tracking-wide text-gray-500'>
            Recent changes
          </h3>
          <ul className='space-y-1 text-sm'>
            {changes.slice(0, 10).map((change) => (
              <li key={change.id} className='flex flex-wrap gap-x-2'>
                <span className='text-gray-500'>
                  {formatDate(change.createdAt)}
                </span>
                <span>{nameOf(change.publicId)}:</span>
                <span>{describeMembershipChange(change, organizationId)}</span>
                <span className='text-gray-500'>by {nameOf(change.actor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
