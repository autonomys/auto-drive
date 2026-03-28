import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Button } from '@auto-drive/ui';
import { useEncryptionStore } from 'globalStates/encryption';
import { useNetwork } from 'contexts/network';
import { useFileTableState } from '@/components/organisms/FileTable/state';
import { useRuntimeConfig } from '@/config/RuntimeConfigProvider';

type FileProgress = {
  progress: number;
  fileName: string;
  fileSize: number;
  completed: boolean;
  error?: boolean;
  errorMessage?: string;
};

export const UploadingFileModal = ({
  files,
  onClose,
}: {
  files: File[] | null;
  onClose: () => void;
  password?: string;
  compress?: boolean;
}) => {
  const { maxFilesLimit } = useRuntimeConfig();
  const [fileProgresses, setFileProgresses] = useState<FileProgress[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [password, setPassword] = useState<string>();
  const [passwordConfirmed, setPasswordConfirmed] = useState<boolean>();
  const [tooManyFiles, setTooManyFiles] = useState(false);
  const [uploadError, setUploadError] = useState<boolean>(false);
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string>();
  const uploadStartedRef = useRef(false);
  const network = useNetwork();
  const refetch = useFileTableState((v) => v.fetch);

  const totalFiles = files?.length || 0;

  const resetUploadState = useCallback(() => {
    setFileProgresses([]);
    setOverallProgress(0);
    setPassword(undefined);
    setPasswordConfirmed(false);
    setUploadError(false);
    setUploadErrorMessage(undefined);
    uploadStartedRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    resetUploadState();
    setTooManyFiles(false);
    onClose();
  }, [onClose, resetUploadState]);

  // Check if too many files are selected
  useEffect(() => {
    if (files && files.length > maxFilesLimit) {
      setTooManyFiles(true);
    } else {
      setTooManyFiles(false);
    }
  }, [files]);

  // Initialize file progress tracking when files change
  useEffect(() => {
    // Only reset if files is null/undefined/empty, not when changing from one set to another
    if (!files || files.length === 0) {
      resetUploadState();
      return;
    }

    if (files.length <= maxFilesLimit) {
      const initialProgresses = files.map((file) => ({
        progress: 0,
        fileName: file.name,
        fileSize: file.size,
        completed: false,
      }));
      setFileProgresses(initialProgresses);
    }
  }, [files, resetUploadState]);

  const manageUpload = useCallback(
    async (password: string | undefined) => {
      if (!files || files.length === 0) return;
      // Don't proceed if too many files
      if (files.length > maxFilesLimit) {
        return;
      }

      // Clear any previous upload errors
      setUploadError(false);
      setUploadErrorMessage(undefined);

      try {
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

        return true;
      } catch (error) {
        // Catch any errors that occur before or during the upload setup
        console.error('Upload failed:', error);
        setUploadError(true);
        setUploadErrorMessage(
          error instanceof Error ? error.message : 'Upload failed',
        );
        uploadStartedRef.current = false;
        return false;
      }
    },
    [files, network.uploadService],
  );

  const onConfirmPassword = useCallback(async () => {
    if (passwordConfirmed) {
      const success = await manageUpload(password || undefined);
      if (success) {
        refetch();
        setTimeout(() => {
          handleClose();
        }, 1000);
      }
    }
  }, [passwordConfirmed, manageUpload, password, refetch, handleClose]);

  useEffect(() => {
    if (!passwordConfirmed || uploadStartedRef.current) {
      return;
    }
    uploadStartedRef.current = true;
    onConfirmPassword();
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
        <div className='fixed inset-0 flex items-center justify-center bg-background-hover bg-opacity-50'>
          <div className='min-w-[400px] max-w-[600px] transform rounded-lg bg-background p-6 shadow-lg transition-transform'>
            {tooManyFiles ? (
              <div className='p-4'>
                <div className='text-light-danger mb-4 text-center font-medium'>
                  Too many files selected
                </div>
                <div className='text-foreground-hover mb-6 text-center text-sm'>
                  You can upload a maximum of {maxFilesLimit} files at once.
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
                {uploadError ? (
                  <div className='p-4'>
                    <div className='text-light-danger mb-4 text-center font-medium'>
                      Upload Failed
                    </div>
                    {uploadErrorMessage && (
                      <div className='text-foreground-hover mb-6 text-center text-sm'>
                        {uploadErrorMessage}
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
                    {totalFiles > 1 && (
                      <div className='mb-4'>
                        <div className='text-foreground-hover mb-1 text-sm font-medium'>
                          Overall progress
                        </div>
                        <div className='relative h-2 w-full rounded bg-background-hover'>
                          <div
                            className='bg-light-accent absolute left-0 top-0 h-2 rounded transition-all duration-500'
                            style={{ width: `${overallProgress}%` }}
                          />
                        </div>
                        <div className='text-foreground-hover mt-1 text-right text-xs'>
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
                          <div className='text-foreground-hover mb-1 flex justify-between text-sm font-medium'>
                            <div
                              className={`truncate ${totalFiles === 1 ? 'max-w-[380px] text-base' : 'max-w-[300px]'}`}
                            >
                              {fileProgress.fileName}
                            </div>
                            <div>
                              ({Math.round(fileProgress.fileSize / 1024)} KB)
                            </div>
                          </div>
                          <div className='relative h-2 w-full rounded bg-background-hover'>
                            <div
                              className={`absolute left-0 top-0 h-2 rounded transition-all duration-500 ${
                                fileProgress.error
                                  ? 'bg-light-danger'
                                  : totalFiles === 1
                                    ? 'bg-light-accent'
                                    : 'bg-light-success'
                              }`}
                              style={{ width: `${fileProgress.progress}%` }}
                            />
                          </div>
                          <div className='text-foreground-hover mt-1 text-right text-xs'>
                            {fileProgress.error ? (
                              <span className='text-light-danger'>Failed</span>
                            ) : (
                              <>
                                {Math.round(fileProgress.progress)}%
                                {fileProgress.completed && ' ✓'}
                              </>
                            )}
                          </div>
                          {fileProgress.error && fileProgress.errorMessage && (
                            <div className='text-foreground-hover mt-1 text-xs'>
                              {fileProgress.errorMessage}
                            </div>
                          )}
                        </div>
                      ))}
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
                  {totalFiles > 1 ? (
                    <div className='text-foreground-hover mb-2 text-center text-sm'>
                      Uploading {totalFiles} files
                    </div>
                  ) : (
                    <div className='text-foreground-hover mb-2 text-center text-sm'>
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
