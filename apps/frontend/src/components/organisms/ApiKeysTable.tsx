import { useCallback, useState } from 'react';
import { ApiKeyCreationModal } from '../molecules/ApiKeyCreationModal';
import {
  ApiKey,
  ApiKeyWithoutSecret,
  CreateApiKeyInput,
} from '@auto-drive/models';
import { DeleteApiKeyModal } from '../molecules/DeleteApiKeyModal';
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
import { usePathname, useRouter } from 'next/navigation';

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

/**
 * API keys, with a create button when `createKey` is given and a delete
 * button on each key when `deleteKey` is.
 */
export const ApiKeysTable = ({
  apiKeys,
  newKeyName,
  createKey,
  deleteKey,
  onChanged,
}: {
  apiKeys: ApiKeyWithoutSecret[] | undefined;
  /** From `?newKey=`: open the create dialog on load with this name. */
  newKeyName?: string;
  createKey?: (input: CreateApiKeyInput) => Promise<ApiKey>;
  deleteKey?: (apiKeyId: string) => Promise<void>;
  /** Reloads the keys after one is created or deleted. */
  onChanged: () => void;
}) => {
  const [isCreationOpen, setIsCreationOpen] = useState(!!newKeyName);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const router = useRouter();
  const pathname = usePathname();

  // Drop `?newKey=` once its dialog closes, so a reload doesn't reopen it and
  // the next manual "Create API Key" starts with an empty name.
  const closeCreationModal = useCallback(() => {
    setIsCreationOpen(false);
    if (newKeyName) router.replace(pathname);
  }, [newKeyName, pathname, router]);
  const openCreationModal = useCallback(() => setIsCreationOpen(true), []);

  const openDeleteModal = useCallback((id: string) => setDeleteId(id), []);
  const closeDeleteModal = useCallback(() => setDeleteId(null), []);

  const nonDeletedApiKeys = apiKeys?.filter((apiKey) => !apiKey.deletedAt);
  const columnCount = deleteKey ? 5 : 4;

  const onCreationSuccess = useCallback(() => {
    closeCreationModal();
    onChanged();
  }, [closeCreationModal, onChanged]);

  return (
    <div className='flex flex-col'>
      {createKey && (
        <>
          <ApiKeyCreationModal
            isOpen={isCreationOpen}
            onClose={closeCreationModal}
            onSuccess={onCreationSuccess}
            createKey={createKey}
            initialName={newKeyName}
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
        </>
      )}
      {deleteKey && (
        <DeleteApiKeyModal
          apiKeyId={deleteId}
          closeModal={closeDeleteModal}
          deleteKey={deleteKey}
          onDeleted={onChanged}
        />
      )}
      <div className='mb-8'>
        <div className='w-full min-w-[fit-content] border-b border-gray-200 shadow sm:rounded-lg'>
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Name</TableHeadCell>
                <TableHeadCell>Key</TableHeadCell>
                <TableHeadCell>Created</TableHeadCell>
                <TableHeadCell>Expires</TableHeadCell>
                {deleteKey && <TableHeadCell>Actions</TableHeadCell>}
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {nonDeletedApiKeys &&
                nonDeletedApiKeys.map((apiKey) => {
                  const expired = isExpired(apiKey.expiresAt);
                  return (
                    <TableBodyRow key={apiKey.id}>
                      <TableBodyCell>
                        {apiKey.name ? (
                          <span className='font-medium'>{apiKey.name}</span>
                        ) : (
                          <span className='text-gray-400'>—</span>
                        )}
                      </TableBodyCell>
                      <TableBodyCell>
                        <span className='font-mono text-xs'>
                          {apiKey.maskedSecret}
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
                      {deleteKey && (
                        <TableBodyCell>
                          <Button
                            variant='lightDanger'
                            className='text-sm'
                            onClick={() => openDeleteModal(apiKey.id)}
                          >
                            Delete
                          </Button>
                        </TableBodyCell>
                      )}
                    </TableBodyRow>
                  );
                })}
              {nonDeletedApiKeys && nonDeletedApiKeys.length === 0 && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={columnCount}
                    className='whitespace-nowrap px-6 py-4 text-center text-sm text-gray-500'
                  >
                    No API keys found
                  </TableBodyCell>
                </TableBodyRow>
              )}
              {!nonDeletedApiKeys && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={columnCount}
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
