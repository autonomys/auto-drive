import { useCallback, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Button } from 'components/common/Button';
import { useEncryptionStore } from 'states/encryption';
import { useNetwork } from 'contexts/network';
import { useFileTableState } from 'views/FileTables/state';

export const UploadingFileModal = ({
  file,
  onClose,
}: {
  file: File | null;
  onClose: () => void;
  password?: string;
  compress?: boolean;
}) => {
  const [progress, setProgress] = useState(0);
  const [password, setPassword] = useState<string>();
  const [passwordConfirmed, setPasswordConfirmed] = useState<boolean>();
  const network = useNetwork();
  const manageUpload = useCallback(
    async (password: string | undefined) => {
      if (!file) return;

      await network.uploadService.uploadFile(file, {
        password,
        onProgress: (progress) => setProgress(progress),
      });

      onClose();
      setPasswordConfirmed(false);
    },
    [file, onClose, network.uploadService],
  );

  const refetch = useFileTableState((v) => v.fetch);

  const onConfirmPassword = useCallback(() => {
    if (passwordConfirmed) {
      const passwordToUse = password ?? undefined;
      manageUpload(passwordToUse).then(() => {
        refetch();
      });
    }
  }, [passwordConfirmed, manageUpload, password, refetch]);

  useEffect(() => {
    if (passwordConfirmed) {
      onConfirmPassword();
    }
  }, [passwordConfirmed, onConfirmPassword]);

  const progressPercentage = Math.round(progress);

  const defaultPassword = useEncryptionStore((store) => store.password);

  const setDefaultPassword = useCallback(() => {
    setPassword(defaultPassword);
    setPasswordConfirmed(true);
  }, [defaultPassword]);

  return (
    <Transition show={!!file}>
      <Dialog as='div' onClose={onClose}>
        <div className='fixed inset-0 flex items-center justify-center bg-black/25 bg-opacity-50 dark:bg-darkBlack/25'>
          <div className='min-w-[25%] transform rounded-lg bg-white p-6 shadow-lg transition-transform dark:bg-darkWhite'>
            {passwordConfirmed ? (
              <div>
                <div className='relative h-2 w-full rounded bg-gray-200'>
                  <div
                    className='absolute left-0 top-0 h-2 rounded bg-green-500 transition-all duration-500'
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className='mt-4 flex justify-center text-sm font-semibold text-black dark:text-darkBlack'>
                  <div>Uploading... {progressPercentage}%</div>
                </div>
              </div>
            ) : (
              <div>
                <div className='flex flex-col gap-2 p-4'>
                  <span className='text-md block text-center font-semibold text-gray-700 dark:text-darkBlack'>
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
                </div>
              </div>
            )}
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
