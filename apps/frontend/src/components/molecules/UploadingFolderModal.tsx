import { useCallback, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Button } from '@auto-drive/ui';
import { FileWarning } from 'lucide-react';
import { useEncryptionStore } from 'globalStates/encryption';
import { useNetwork } from 'contexts/network';
import { useFileTableState } from '@/components/organisms/FileTable/state';

export const UploadingFolderModal = ({
  data,
  onClose,
}: {
  data: FileList | null;
  onClose: () => void;
}) => {
  const [password, setPassword] = useState<string>();
  const [passwordConfirmed, setPasswordConfirmed] = useState<boolean>();
  const [progress, setProgress] = useState(0);
  const network = useNetwork();

  const progressPercentage = Math.round(progress);

  const refetch = useFileTableState((v) => v.fetch);

  const handleUpload = useCallback(async () => {
    if (!data) return;

    const passwordToUse = password ? password : undefined;

    await network.uploadService.uploadFolder(data, {
      password: passwordToUse,
      onProgress: (progress) => setProgress(progress),
    });

    setPasswordConfirmed(false);
    onClose();
    refetch();
  }, [data, password, onClose, network.uploadService, refetch]);

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
        <div className='bg-background-hover fixed inset-0 flex items-center justify-center bg-opacity-50'>
          <div className='bg-background-hover min-w-[25%] transform rounded-lg bg-background p-6 shadow-lg transition-transform'>
            <h3 className='text-foreground-hover mb-4 text-center text-lg font-medium'>
              Uploading Folder
            </h3>
            {passwordConfirmed ? (
              <div>
                <div className='bg-background-hover relative h-2 w-full rounded'>
                  <div
                    className='bg-light-success absolute left-0 top-0 h-2 rounded transition-all duration-500'
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className='mt-4 flex justify-center text-sm font-semibold'>
                  <div>Uploading... {progressPercentage}%</div>
                </div>
                <div className='mt-2 flex justify-between'>
                  <div className='bg-background-hover h-1 w-1 animate-pulse rounded-full' />
                  <div className='bg-background-hover h-1 w-1 animate-pulse rounded-full' />
                  <div className='bg-background-hover h-1 w-1 animate-pulse rounded-full' />
                </div>
              </div>
            ) : (
              <div>
                <div className='flex flex-col gap-2 p-4'>
                  <span className='text-foreground-hover text-md block text-center font-semibold'>
                    Enter Encrypting Password
                  </span>
                  <input
                    type='password'
                    id='password'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className='border-background-hover mt-1 block w-full rounded-md border p-2 shadow-sm'
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
                  <div className='text-foreground-hover mt-4 flex items-center gap-2 overflow-hidden rounded bg-yellow-50 p-2'>
                    <FileWarning className='text-light-warning h-4 w-4' />
                    <span className='text-foreground-hover text-sm font-semibold'>
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
