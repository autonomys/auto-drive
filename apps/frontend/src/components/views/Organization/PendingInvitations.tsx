'use client';

import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@auto-drive/ui';
import { useNetwork } from '@/contexts/network';
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
import { ROLE_LABEL } from '@/utils/organization';

/**
 * Invitations not yet accepted, declined or expired. Shown to organization
 * admins and Auto Drive admins, who can revoke them. Hidden when there are
 * none.
 */
export const PendingInvitations = ({
  organizationId,
  queryKey,
}: {
  organizationId: string;
  queryKey: unknown[];
}) => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();

  const { data: invitations } = useQuery({
    queryKey,
    queryFn: () => api.getOrganizationInvitations(organizationId),
  });

  const {
    mutate: revoke,
    isPending: isRevoking,
    variables: revokingId,
  } = useMutation({
    mutationFn: (invitationId: string) =>
      api.revokeOrganizationInvitation(organizationId, invitationId),
    onSuccess: () => {
      toast.success('Invitation revoked');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!invitations?.length) return null;

  return (
    <div>
      <h3 className='mb-3 text-sm font-medium uppercase tracking-wide text-gray-500'>
        Pending invitations
      </h3>
      <div className='overflow-x-auto'>
        <Table className='min-w-full'>
          <TableHead>
            <TableHeadRow>
              <TableHeadCell>Public ID</TableHeadCell>
              <TableHeadCell>Role</TableHeadCell>
              <TableHeadCell>Invited</TableHeadCell>
              <TableHeadCell>Expires</TableHeadCell>
              <TableHeadCell>{''}</TableHeadCell>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {invitations.map((invitation) => (
              <TableBodyRow key={invitation.id}>
                <TableBodyCell>
                  <CopiableText
                    text={invitation.publicId}
                    className='break-all font-mono text-sm'
                  />
                </TableBodyCell>
                <TableBodyCell>{ROLE_LABEL[invitation.role]}</TableBodyCell>
                <TableBodyCell>
                  {formatDate(invitation.createdAt)}
                </TableBodyCell>
                <TableBodyCell>
                  {formatDate(invitation.expiresAt)}
                </TableBodyCell>
                <TableBodyCell className='text-right'>
                  <Button
                    variant='lightDanger'
                    size='sm'
                    disabled={isRevoking && revokingId === invitation.id}
                    onClick={() => revoke(invitation.id)}
                  >
                    Revoke
                  </Button>
                </TableBodyCell>
              </TableBodyRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
