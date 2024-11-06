import { useCallback, useEffect, useState } from 'react';
import { UploadService } from '../../services/upload';
import { Dialog, Transition } from '@headlessui/react';
import { FolderTree } from '../../models/FileTree';
import { Button } from '../common/Button';
import { shortenString } from '../../utils/misc';
import { FileWarning } from 'lucide-react';
import { useEncryptionStore } from '../../states/encryption';

export const UploadingFolderModal = ({
  data,
  onClose,
}: {
  data: { files: Record<string, File>; fileTree: FolderTree } | null;
  onClose: () => void;
}) => {
  const [password, setPassword] = useState<string>();
  const [passwordConfirmed, setPasswordConfirmed] = useState<boolean>();
  const [progress, setProgress] = useState(0);

  const progressPercentage = Math.round(progress);

  const handleUpload = useCallback(async () => {
    if (!data) return;

    const passwordToUse = password ? password : undefined;

    if (passwordToUse) {
      const progressIterable = UploadService.createEncryptedFolderUpload(
        data.fileTree,
        data.files,
        passwordToUse,
      );
      for await (const progress of progressIterable) {
        setProgress(progress);
      }
    } else {
      const progressIterable = UploadService.uploadFolder(
        data.fileTree,
        data.files,
        {
          compress: true,
        },
      );
      for await (const progress of progressIterable) {
        setProgress(progress);
      }
    }

    setPasswordConfirmed(false);
    onClose();
  }, [data, password, onClose]);

  useEffect(() => {
    if (!passwordConfirmed) return;

    handleUpload();
  }, [passwordConfirmed, handleUpload, onClose]);

  const defaultPassword = useEncryptionStore((store) => store.password);

  const setDefaultPassword = useCallback(() => {
    setPassword(defaultPassword);
    setPasswordConfirmed(true);
  }, [defaultPassword]);

  return (
    <Transition show={!!data}>
      <Dialog as='div' onClose={onClose}>
        <div className='fixed inset-0 flex items-center justify-center bg-black bg-opacity-50'>
          <div className='min-w-[25%] transform rounded-lg bg-white p-6 shadow-lg transition-transform'>
            <h3 className='mb-4 text-center text-lg font-medium'>
              Uploading{' '}
              <strong>{shortenString(data?.fileTree.name ?? '', 20)}</strong>
            </h3>
            {passwordConfirmed ? (
              <div>
                <div className='relative h-2 w-full rounded bg-gray-200'>
                  <div
                    className='absolute left-0 top-0 h-2 rounded bg-green-500 transition-all duration-500'
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className='mt-4 flex justify-center text-sm font-semibold'>
                  <div>Uploading... {progressPercentage}%</div>
                </div>
                <div className='mt-2 flex justify-between'>
                  <div className='h-1 w-1 animate-pulse rounded-full bg-gray-500' />
                  <div className='h-1 w-1 animate-pulse rounded-full bg-gray-500' />
                  <div className='h-1 w-1 animate-pulse rounded-full bg-gray-500' />
                </div>
              </div>
            ) : (
              <div>
                <div className='flex flex-col gap-2 p-4'>
                  <span className='text-md block text-center font-semibold text-gray-700'>
                    Enter Encrypting Password
                  </span>
                  <input
                    type='password'
                    id='password'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className='mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm'
                    placeholder='Password'
                  />
                  <div className='flex justify-center gap-2'>
                    <Button
                      disabled={!defaultPassword}
                      className='text-xs'
                      variant='lightAccent'
                      onClick={setDefaultPassword}
                    >
                      Encrypt with default password
                    </Button>
                    <Button
                      className='text-xs'
                      variant='lightAccent'
                      onClick={() => setPasswordConfirmed(true)}
                    >
                      {password
                        ? 'Confirm Password'
                        : 'Upload without encryption'}
                    </Button>
                    <Button
                      className='text-xs'
                      variant='lightDanger'
                      onClick={onClose}
                    >
                      Cancel
                    </Button>
                  </div>
                  <div className='mt-4 flex items-center gap-2 overflow-hidden rounded bg-yellow-50 p-2'>
                    <FileWarning className='h-4 w-4 text-yellow-500' />
                    <span className='text-sm font-semibold text-gray-500'>
                      Encrypted folders will be uploaded as encrypted zip files.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
