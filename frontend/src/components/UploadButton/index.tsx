import { Button } from '@/components/common/Button';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { FileIcon, FolderIcon, PlusIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { UploadingFolderModal } from '../FileTables/common/UploadingFolderModal';
import { UploadingFileModal } from '../FileTables/common/UploadingFileModal';

export const UploadButton = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFile, setUploadingFile] = useState<File[] | null>(null);
  const [uploadingFolder, setUploadingFolder] = useState<FileList | null>(null);

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const openFolderDialog = () => {
    folderInputRef.current?.click();
  };

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const filesArray = Array.from(e.target.files);
        setUploadingFile(filesArray);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [],
  );

  const handleFolderInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        if (!e.target.files) return;
        setUploadingFolder(e.target.files);
      }
    },
    [],
  );

  return (
    <>
      <Popover>
        <UploadingFileModal
          files={uploadingFile}
          onClose={() => setUploadingFile(null)}
        />
        <UploadingFolderModal
          data={uploadingFolder}
          onClose={() => setUploadingFolder(null)}
        />
        <PopoverButton as='div'>
          <Button
            variant='primaryOutline'
            className='flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-gray-800 shadow-sm hover:bg-gray-200'
          >
            <PlusIcon className='h-5 w-5' />
            <span>New</span>
          </Button>
        </PopoverButton>
        <PopoverPanel className='relative'>
          <div className='absolute left-0 top-1 flex text-nowrap rounded-md bg-white text-black shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-darkWhiteHover dark:text-darkBlack'>
            <div className='p-1'>
              <button
                onClick={openFileDialog}
                className='flex w-full items-center rounded-md px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-darkWhite'
              >
                <FileIcon className='mr-3 h-5 w-5' />
                Select Files
              </button>
              <button
                onClick={openFolderDialog}
                className='flex w-full items-center rounded-md px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-darkWhite'
              >
                <FolderIcon className='mr-3 h-5 w-5' />
                Select Folder
              </button>
            </div>
          </div>
        </PopoverPanel>
      </Popover>
      <input
        type='file'
        ref={fileInputRef}
        onChange={handleFileInputChange}
        className='hidden'
        multiple
      />
      <input
        type='file'
        ref={folderInputRef}
        onChange={handleFolderInputChange}
        className='hidden'
        webkitdirectory='true'
      />
    </>
  );
};
