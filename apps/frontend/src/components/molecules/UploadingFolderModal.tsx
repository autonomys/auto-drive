import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const uploadStartedRef = useRef(false);
  const network = useNetwork();

  const progressPercentage = Math.round(progress);

  const refetch = useFileTableState((v) => v.fetch);

  const resetUploadState = useCallback(() => {
    setPassword(undefined);
    setPasswordConfirmed(false);
    setProgress(0);
    setError(false);
    setErrorMessage(undefined);
    uploadStartedRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    resetUploadState();
    onClose();
  }, [onClose, resetUploadState]);

  const handleUpload = useCallback(async () => {
    if (!data) return false;

    try {
      setError(false);
      setErrorMessage(undefined);
      await network.uploadService.uploadFolder(data, {
        password: password || undefined,
        onProgress: (progress) => setProgress(progress),
      });

      return true;
    } catch (error) {
      console.error('Failed to upload folder:', error);
      setError(true);
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed');
      uploadStartedRef.current = false;
      return false;
    }
  }, [data, password, network.uploadService]);

  useEffect(() => {
    if (!passwordConfirmed || uploadStartedRef.current) return;

    const performUpload = async () => {
      uploadStartedRef.current = true;
      const success = await handleUpload();
      if (success) {
        refetch();
        handleClose();
      }
    };

    performUpload();
  }, [passwordConfirmed, handleUpload, refetch, handleClose]);

  useEffect(() => {
    // Only reset if data is null/undefined, not when changing from one FileList to another
    if (!data) {
      resetUploadState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const defaultPassword = useEncryptionStore((store) => store.password);

  const setDefaultPassword = useCallback(() => {
    setPassword(defaultPassword);
    setPasswordConfirmed(true);
  }, [defaultPassword]);

  return (
    <Transition show={!!data}>
      <Dialog as='div' onClose={handleClose}>
        <div className='fixed inset-0 flex items-center justify-center bg-background-hover bg-opacity-50'>
          <div className='min-w-[25%] transform rounded-lg bg-background p-6 shadow-lg transition-transform'>
            <h3 className='text-foreground-hover mb-4 text-center text-lg font-medium'>
              Uploading Folder
            </h3>
            {passwordConfirmed ? (
              <div>
                {error ? (
                  <div className='p-4'>
                    <div className='text-light-danger mb-4 text-center font-medium'>
                      Upload Failed
                    </div>
                    {errorMessage && (
                      <div className='text-foreground-hover mb-6 text-center text-sm'>
                        {errorMessage}
                      </div>
                    )}
                    <div className='flex justify-center'>
                      <Button
                        className='text-sm'
                        variant='lightDanger'
                        onClick={handleClose}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className='relative h-2 w-full rounded bg-background-hover'>
                      <div
                        className='bg-light-success absolute left-0 top-0 h-2 rounded transition-all duration-500'
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className='mt-4 flex justify-center text-sm font-semibold'>
                      <div>Uploading... {progressPercentage}%</div>
                    </div>
                    <div className='mt-2 flex justify-between'>
                      <div className='h-1 w-1 animate-pulse rounded-full bg-background-hover' />
                      <div className='h-1 w-1 animate-pulse rounded-full bg-background-hover' />
                      <div className='h-1 w-1 animate-pulse rounded-full bg-background-hover' />
                    </div>
                  </>
                )}
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
                    className='mt-1 block w-full rounded-md border border-background-hover p-2 shadow-sm'
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
                      onClick={handleClose}
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
