import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { FileIcon, FolderIcon } from 'lucide-react';
import React, { useCallback, useRef, useState } from 'react';
import { UploadingFileModal } from './UploadingFileModal';
import { UploadingFolderModal } from './UploadingFolderModal';
import toast from 'react-hot-toast';

export function FileDropZone() {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [uploadingFolder, setUploadingFolder] = useState<FileList | null>(null);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const readEntriesPromise = useCallback(
    (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => {
      return new Promise((resolve) => {
        reader.readEntries((entries) => resolve(entries));
      });
    },
    [],
  );

  const readEntryAsFile = useCallback((entry: FileSystemFileEntry) => {
    return new Promise<File>((resolve) => {
      entry.file((file) => resolve(file));
    });
  }, []);

  const getRecursiveEntry = useCallback(
    async (
      entry: FileSystemEntry,
    ): Promise<{ entry: FileSystemEntry; file: File }[]> => {
      if (entry.isFile) {
        return [
          { entry, file: await readEntryAsFile(entry as FileSystemFileEntry) },
        ];
      } else if (entry.isDirectory) {
        const directoryReader = (
          entry as FileSystemDirectoryEntry
        ).createReader();

        const subentries = await readEntriesPromise(directoryReader);

        return Promise.all(
          subentries.map((subentry) => getRecursiveEntry(subentry)),
        ).then((entries) => [...entries.flat()]);
      } else {
        console.log('entry is not a file or directory', entry);
        return [];
      }
    },
    [readEntryAsFile, readEntriesPromise],
  );

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.items.length === 0) {
      toast.error('No files selected');
      return;
    }
    if (e.dataTransfer.items.length > 1) {
      toast.error('Only one file can be uploaded at a time');
      return;
    }

    const item = e.dataTransfer.items[0];

    const entry = item.webkitGetAsEntry();

    if (entry?.isFile) {
      if (e.dataTransfer.files && fileInputRef.current) {
        fileInputRef.current.files = e.dataTransfer.files;
        fileInputRef.current.dispatchEvent(
          new Event('change', { bubbles: true }),
        );
      }
    } else if (entry?.isDirectory) {
      toast.error('Use select folder instead of dragging');
    }
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const file = e.target.files[0];
        setUploadingFile(file);
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

  const openFolderDialog = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className='flex max-w-full flex-col gap-4'>
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
      <Popover as='div' className='relative'>
        <PopoverButton as='div'>
          <div
            className={`flex h-20 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
              isDragging ? 'border-green-800 bg-green-50' : 'border-green-700'
            }`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <p className='text-center text-green-600'>
              Add or drop files / folders here
            </p>
          </div>
        </PopoverButton>
        <Transition
          enter='transition duration-100 ease-out'
          enterFrom='transform scale-95 opacity-0'
          enterTo='transform scale-100 opacity-100'
          leave='transition duration-75 ease-out'
          leaveFrom='transform scale-100 opacity-100'
          leaveTo='transform scale-95 opacity-0'
        >
          <PopoverPanel className='absolute z-10 w-full'>
            <div className='rounded-md bg-white text-black shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-darkWhiteHover dark:text-darkBlack'>
              <div className='p-4'>
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
        </Transition>
      </Popover>
      <UploadingFileModal
        file={uploadingFile}
        onClose={() => setUploadingFile(null)}
      />
      <UploadingFolderModal
        data={uploadingFolder}
        onClose={() => setUploadingFolder(null)}
      />
    </div>
  );
}
