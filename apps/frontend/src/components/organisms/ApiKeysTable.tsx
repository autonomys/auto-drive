import { useCallback, useState } from 'react';
import { ApiKeyCreationModal } from '../molecules/ApiKeyCreationModal';
import { ApiKeyWithoutSecret } from '@auto-drive/models';
import { DeleteApiKeyModal } from '../molecules/DeleteApiKeyModal';
import { RotateApiKeyModal } from '../molecules/RotateApiKeyModal';
import { Loader } from 'lucide-react';
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
import { Button } from '@auto-drive/ui';
import { useRouter } from 'next/navigation';

const formatDate = (d: Date | string | null): string => {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const isExpired = (d: Date | string | null): boolean => {
  if (!d) return false;
  const date = typeof d === 'string' ? new Date(d) : d;
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now();
};

const COLUMN_COUNT = 5;

export const ApiKeysTable = ({
  apiKeys,
}: {
  apiKeys: ApiKeyWithoutSecret[] | undefined;
}) => {
  const [isCreationOpen, setIsCreationOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const closeCreationModal = useCallback(() => setIsCreationOpen(false), []);
  const openCreationModal = useCallback(() => setIsCreationOpen(true), []);

  const openDeleteModal = useCallback((id: string) => setDeleteId(id), []);
  const closeDeleteModal = useCallback(() => setDeleteId(null), []);

  const openRotateModal = useCallback(
    (id: string, name: string) => setRotateTarget({ id, name }),
    [],
  );
  const closeRotateModal = useCallback(() => setRotateTarget(null), []);

  const nonDeletedApiKeys = apiKeys?.filter((apiKey) => !apiKey.deletedAt);

  const router = useRouter();

  const refresh = useCallback(() => router.refresh(), [router]);

  const onCreationSuccess = useCallback(() => {
    closeCreationModal();
    refresh();
  }, [closeCreationModal, refresh]);

  return (
    <div className='flex flex-col'>
      <ApiKeyCreationModal
        isOpen={isCreationOpen}
        onClose={closeCreationModal}
        onSuccess={onCreationSuccess}
      />
      <DeleteApiKeyModal apiKeyId={deleteId} closeModal={closeDeleteModal} />
      <RotateApiKeyModal
        apiKeyId={rotateTarget?.id ?? null}
        apiKeyName={rotateTarget?.name ?? null}
        closeModal={closeRotateModal}
        onRotated={refresh}
      />
      <div className='flex'>
        <Button
          className='mb-4 text-sm'
          variant='lightAccent'
          onClick={openCreationModal}
        >
          Create API Key
        </Button>
      </div>
      <div className='mb-8'>
        <div className='w-full min-w-[fit-content] border-b border-gray-200 shadow sm:rounded-lg'>
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Name</TableHeadCell>
                <TableHeadCell>Key</TableHeadCell>
                <TableHeadCell>Created</TableHeadCell>
                <TableHeadCell>Expires</TableHeadCell>
                <TableHeadCell>Actions</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {nonDeletedApiKeys &&
                nonDeletedApiKeys.map((apiKey) => {
                  const expired = isExpired(apiKey.expiresAt);
                  return (
                    <TableBodyRow key={apiKey.id}>
                      <TableBodyCell>
                        <span className='font-medium'>{apiKey.name}</span>
                      </TableBodyCell>
                      <TableBodyCell>
                        <span className='font-mono text-xs'>
                          {apiKey.prefix}
                          <span className='text-gray-400'>…</span>
                        </span>
                      </TableBodyCell>
                      <TableBodyCell>
                        {formatDate(apiKey.createdAt)}
                      </TableBodyCell>
                      <TableBodyCell>
                        {apiKey.expiresAt ? (
                          <span
                            className={
                              expired
                                ? 'text-red-600'
                                : 'text-foreground'
                            }
                            title={
                              expired
                                ? 'This key has expired and can no longer be used'
                                : undefined
                            }
                          >
                            {formatDate(apiKey.expiresAt)}
                            {expired ? ' (expired)' : ''}
                          </span>
                        ) : (
                          <span className='text-gray-400'>Never</span>
                        )}
                      </TableBodyCell>
                      <TableBodyCell>
                        <div className='flex gap-2'>
                          <Button
                            variant='lightAccent'
                            className='text-sm'
                            onClick={() =>
                              openRotateModal(apiKey.id, apiKey.name)
                            }
                          >
                            Rotate
                          </Button>
                          <Button
                            variant='lightDanger'
                            className='text-sm'
                            onClick={() => openDeleteModal(apiKey.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableBodyCell>
                    </TableBodyRow>
                  );
                })}
              {nonDeletedApiKeys && nonDeletedApiKeys.length === 0 && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={COLUMN_COUNT}
                    className='whitespace-nowrap px-6 py-4 text-center text-sm text-gray-500'
                  >
                    No API keys found
                  </TableBodyCell>
                </TableBodyRow>
              )}
              {!nonDeletedApiKeys && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={COLUMN_COUNT}
                    className='whitespace-nowrap px-6 py-4 text-center text-sm text-gray-500'
                  >
                    <span className='flex items-center justify-center'>
                      <Loader className='h-4 w-4 animate-spin' />
                    </span>
                  </TableBodyCell>
                </TableBodyRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};
