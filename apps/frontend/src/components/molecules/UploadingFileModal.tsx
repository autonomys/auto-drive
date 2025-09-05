import { useCallback, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Button } from '@auto-drive/ui';
import { useEncryptionStore } from 'globalStates/encryption';
import { useNetwork } from 'contexts/network';
import { useFileTableState } from '@/components/organisms/FileTable/state';

type FileProgress = {
  progress: number;
  fileName: string;
  fileSize: number;
  completed: boolean;
  error?: boolean;
  errorMessage?: string;
};

// Maximum number of files allowed to upload at once
const MAX_FILES_LIMIT = parseInt(
  process.env.NEXT_PUBLIC_MAX_FILES_LIMIT || '10',
);

export const UploadingFileModal = ({
  files,
  onClose,
}: {
  files: File[] | null;
  onClose: () => void;
  password?: string;
  compress?: boolean;
}) => {
  const [fileProgresses, setFileProgresses] = useState<FileProgress[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [password, setPassword] = useState<string>();
  const [passwordConfirmed, setPasswordConfirmed] = useState<boolean>();
  const [tooManyFiles, setTooManyFiles] = useState(false);
  const network = useNetwork();
  const refetch = useFileTableState((v) => v.fetch);

  const totalFiles = files?.length || 0;

  const handleClose = useCallback(() => {
    setFileProgresses([]);
    setOverallProgress(0);
    setPassword(undefined);
    setPasswordConfirmed(false);
    setTooManyFiles(false);
    onClose();
  }, [onClose]);

  // Check if too many files are selected
  useEffect(() => {
    if (files && files.length > MAX_FILES_LIMIT) {
      setTooManyFiles(true);
    } else {
      setTooManyFiles(false);
    }
  }, [files]);

  // Initialize file progress tracking when files change
  useEffect(() => {
    if (files && files.length > 0 && files.length <= MAX_FILES_LIMIT) {
      const initialProgresses = files.map((file) => ({
        progress: 0,
        fileName: file.name,
        fileSize: file.size,
        completed: false,
      }));
      setFileProgresses(initialProgresses);
    }

    // Cleanup function to reset state when files change or component unmounts
    return () => {
      if (!files) {
        setFileProgresses([]);
        setOverallProgress(0);
        setPassword(undefined);
        setPasswordConfirmed(false);
        setTooManyFiles(false);
      }
    };
  }, [files]);

  const manageUpload = useCallback(
    async (password: string | undefined) => {
      if (!files || files.length === 0) return;
      // Don't proceed if too many files
      if (files.length > MAX_FILES_LIMIT) {
        return;
      }
      // Setup progress update handler for a specific file
      const createProgressHandler = (index: number) => (progress: number) => {
        setFileProgresses((prev) => {
          const newProgresses = [...prev];
          newProgresses[index] = {
            ...newProgresses[index],
            progress,
            completed: progress === 100,
          };
          const totalProgress =
            newProgresses.reduce((sum, file) => sum + file.progress, 0) /
            newProgresses.length;

          setOverallProgress(totalProgress);
          return newProgresses;
        });
      };

      const results: { success: boolean; file: File }[] = [];

      // Upload files in parallel, but handle errors individually
      const uploadPromises = files.map((file, index) =>
        network.uploadService
          .uploadFile(file, {
            password,
            onProgress: createProgressHandler(index),
          })
          .then(() => {
            results.push({ success: true, file });
            // Mark as completed in our UI
            setFileProgresses((prev) => {
              const newProgresses = [...prev];
              newProgresses[index] = {
                ...newProgresses[index],
                progress: 100,
                completed: true,
              };
              return newProgresses;
            });
          })
          .catch((error) => {
            console.error(`Failed to upload file ${file.name}:`, error);
            results.push({ success: false, file });
            // Mark as failed in our UI
            setFileProgresses((prev) => {
              const newProgresses = [...prev];
              newProgresses[index] = {
                ...newProgresses[index],
                progress: 0,
                completed: false,
                error: true, // Add error flag
                errorMessage: error.message || 'Upload failed',
              };
              return newProgresses;
            });
          }),
      );
      // Wait for all uploads to complete (whether success or failure)
      await Promise.allSettled(uploadPromises);

      refetch();
      setTimeout(() => {
        handleClose();
      }, 1000);
    },
    [files, handleClose, network.uploadService, refetch],
  );

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

  const overallProgressPercentage = Math.round(overallProgress);
  const defaultPassword = useEncryptionStore((store) => store.password);

  const setDefaultPassword = useCallback(() => {
    setPassword(defaultPassword);
    setPasswordConfirmed(true);
  }, [defaultPassword]);

  return (
    <Transition show={!!files && files.length > 0}>
      <Dialog as='div' onClose={handleClose}>
        <div className='dark:bg-darkBlack/25 fixed inset-0 flex items-center justify-center bg-black/25 bg-opacity-50'>
          <div className='dark:bg-darkWhite min-w-[400px] max-w-[600px] transform rounded-lg bg-white p-6 shadow-lg transition-transform'>
            {tooManyFiles ? (
              <div className='p-4'>
                <div className='mb-4 text-center font-medium text-red-500'>
                  Too many files selected
                </div>
                <div className='mb-6 text-center text-sm text-gray-700 dark:text-gray-300'>
                  You can upload a maximum of {MAX_FILES_LIMIT} files at once.
                  Please select fewer files and try again.
                </div>
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
            ) : passwordConfirmed ? (
              <div>
                {totalFiles > 1 && (
                  <div className='mb-4'>
                    <div className='mb-1 text-sm font-medium text-gray-700 dark:text-gray-300'>
                      Overall progress
                    </div>
                    <div className='relative h-2 w-full rounded bg-gray-200'>
                      <div
                        className='absolute left-0 top-0 h-2 rounded bg-blue-500 transition-all duration-500'
                        style={{ width: `${overallProgress}%` }}
                      />
                    </div>
                    <div className='mt-1 text-right text-xs text-gray-500 dark:text-gray-400'>
                      {overallProgressPercentage}%
                    </div>
                  </div>
                )}

                <div className='max-h-[300px] overflow-y-auto'>
                  {fileProgresses.map((fileProgress, index) => (
                    <div
                      key={index}
                      className={`mb-3 ${totalFiles === 1 ? 'mt-4' : ''}`}
                    >
                      <div className='mb-1 flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300'>
                        <div
                          className={`truncate ${totalFiles === 1 ? 'max-w-[380px] text-base' : 'max-w-[300px]'}`}
                        >
                          {fileProgress.fileName}
                        </div>
                        <div>
                          ({Math.round(fileProgress.fileSize / 1024)} KB)
                        </div>
                      </div>
                      <div className='relative h-2 w-full rounded bg-gray-200'>
                        <div
                          className={`absolute left-0 top-0 h-2 rounded transition-all duration-500 ${
                            fileProgress.error
                              ? 'bg-red-500'
                              : totalFiles === 1
                                ? 'bg-blue-500'
                                : 'bg-green-500'
                          }`}
                          style={{ width: `${fileProgress.progress}%` }}
                        />
                      </div>
                      <div className='mt-1 text-right text-xs text-gray-500 dark:text-gray-400'>
                        {fileProgress.error ? (
                          <span className='text-red-500'>Failed</span>
                        ) : (
                          <>
                            {Math.round(fileProgress.progress)}%
                            {fileProgress.completed && ' ✓'}
                          </>
                        )}
                      </div>
                      {fileProgress.error && fileProgress.errorMessage && (
                        <div className='mt-1 text-xs text-red-500'>
                          {fileProgress.errorMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div className='flex flex-col gap-2 p-4'>
                  <span className='text-md dark:text-darkBlack block text-center font-semibold text-gray-700'>
                    Enter Encrypting Password
                  </span>
                  {totalFiles > 1 ? (
                    <div className='mb-2 text-center text-sm text-gray-500 dark:text-gray-400'>
                      Uploading {totalFiles} files
                    </div>
                  ) : (
                    <div className='mb-2 text-center text-sm text-gray-500 dark:text-gray-400'>
                      Uploading: {files?.[0]?.name}
                    </div>
                  )}
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
                      onClick={handleClose}
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
