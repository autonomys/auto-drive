'use client';

import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Loader } from 'lucide-react';
import { Button, ROUTES } from '@auto-drive/ui';
import { PartnerOrganization, UserRole } from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { useUserStore } from 'globalStates/user';
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

const QUERY_KEY = ['adminPartnerOrganizations'];

export const PartnerOrganizations = () => {
  const { api, network } = useNetwork();
  const queryClient = useQueryClient();
  const user = useUserStore(({ user }) => user);
  const [name, setName] = useState('');

  const {
    data: partners,
    isLoading,
    isError,
  } = useQuery<PartnerOrganization[]>({
    queryKey: QUERY_KEY,
    queryFn: () => api.listPartnerOrganizations(),
    enabled: user?.role === UserRole.Admin,
  });

  const { mutate: create, isPending: isCreating } = useMutation({
    mutationFn: (name: string) => api.createPartnerOrganization(name),
    onSuccess: (partner) => {
      setName('');
      toast.success(`Created ${partner.name}`);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!user || user.role !== UserRole.Admin) {
    return (
      <div className='flex items-center justify-center py-20'>
        <Loader className='h-8 w-8 animate-spin' />
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <Link
        href={ROUTES.admin(network.id)}
        className='inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
      >
        <ArrowLeft className='h-4 w-4' />
        Back to Admin Dashboard
      </Link>

      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h1 className='mb-1 flex items-center gap-2 text-xl font-semibold'>
          <Building2 className='h-5 w-5' />
          Partner Organizations
        </h1>
        <p className='mb-4 text-sm text-gray-500'>
          Organizations whose members share one partner account. Open an account
          to manage its members.
        </p>

        <form
          className='mb-6 flex gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create(name.trim());
          }}
        >
          <input
            type='text'
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Organization name'
            maxLength={100}
            className='flex-1 rounded-md border border-gray-300 bg-background px-3 py-2 text-sm'
          />
          <Button
            type='submit'
            variant='primary'
            disabled={isCreating || !name.trim()}
          >
            {isCreating ? 'Creating…' : 'Create'}
          </Button>
        </form>

        {isLoading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader className='h-6 w-6 animate-spin' />
          </div>
        ) : isError ? (
          <p className='text-sm text-gray-500'>
            Failed to load partner organizations.
          </p>
        ) : (
          <Table className='min-w-full'>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Name</TableHeadCell>
                <TableHeadCell>Members</TableHeadCell>
                <TableHeadCell>Organization ID</TableHeadCell>
                <TableHeadCell>Account</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {partners?.map((partner) => (
                <TableBodyRow key={partner.id}>
                  <TableBodyCell>
                    {partner.name}
                    {partner.archivedAt && (
                      <span className='ml-2 text-xs text-gray-500'>
                        archived {formatDate(partner.archivedAt)}
                      </span>
                    )}
                  </TableBodyCell>
                  <TableBodyCell>{partner.memberCount}</TableBodyCell>
                  <TableBodyCell>
                    <CopiableText
                      text={partner.id}
                      className='break-all font-mono text-sm'
                    />
                  </TableBodyCell>
                  <TableBodyCell>
                    <Link
                      href={ROUTES.adminOrganization(
                        network.id,
                        partner.accountId,
                      )}
                      className='font-mono text-sm text-primary hover:underline'
                    >
                      {partner.accountId}
                    </Link>
                  </TableBodyCell>
                </TableBodyRow>
              ))}
              {partners?.length === 0 && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={4}
                    className='py-6 text-center text-gray-500'
                  >
                    No partner organizations yet
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
