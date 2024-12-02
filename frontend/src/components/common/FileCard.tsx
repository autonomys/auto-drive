'use client';

import bytes from 'bytes';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import {
  Download,
  DownloadIcon,
  File,
  Folder,
  FolderIcon,
  MoreVertical,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { ObjectDownloadModal } from '../Files/ObjectDownloadModal';
import { handleClick, handleEnterOrSpace } from '../../utils/eventHandler';
import { shortenString } from '../../utils/misc';
import { BaseMetadata } from '../../models/UploadedObjectMetadata';

interface FileCardProps {
  icon?: React.ReactNode;
  metadata: BaseMetadata;
}

export const FileCard = ({
  metadata: { type, name, size, cid },
  icon,
}: FileCardProps) => {
  const router = useRouter();
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  const download = useCallback(() => {
    setIsDownloadModalOpen(true);
  }, []);

  const navigate = useCallback(() => {
    router.push(`/drive/fs/${cid}`);
  }, [cid, router]);

  const objectIcon = useMemo(() => {
    if (icon) return icon;
    return type === 'folder' ? (
      <Folder className='h-8 w-8 text-blue-500' />
    ) : (
      <File className='h-8 w-8 text-gray-500' />
    );
  }, [icon, type]);

  const handleNavigateClick = useMemo(
    () =>
      handleClick(navigate, { stopPropagation: true, preventDefault: true }),
    [navigate],
  );

  const handleNavigateKeyDown = useMemo(
    () =>
      handleEnterOrSpace(navigate, {
        stopPropagation: true,
        preventDefault: true,
      }),
    [navigate],
  );

  const handleDownloadClick = useMemo(
    () =>
      handleClick(download, { stopPropagation: true, preventDefault: true }),
    [download],
  );

  const handleDownloadKeyDown = useMemo(
    () =>
      handleEnterOrSpace(download, {
        stopPropagation: true,
        preventDefault: true,
      }),
    [download],
  );

  return (
    <Popover className='flex flex-1 flex-col'>
      <ObjectDownloadModal
        cid={isDownloadModalOpen ? cid : null}
        onClose={() => setIsDownloadModalOpen(false)}
      />
      <div className='relative flex max-w-sm flex-1 flex-col text-ellipsis rounded-lg border border-gray-200 bg-white p-4 shadow-sm'>
        <div className='mb-4 flex items-start justify-between'>
          {objectIcon}
          <PopoverButton>
            <MoreVertical size={20} />
          </PopoverButton>
        </div>
        <h2 className='mb-2 text-lg font-semibold text-gray-800'>
          {name ? shortenString(name, 20) : shortenString(cid, 20)}
        </h2>
        <p className='mb-4 text-gray-500'>Size: {bytes(Number(size))}</p>
        <button
          onClick={handleDownloadClick}
          className='flex w-full items-center justify-center rounded-lg bg-blue-500 px-4 py-2 font-semibold text-white hover:bg-blue-600'
        >
          <Download size={20} className='mr-2' />
          Download
        </button>
        {type === 'folder' && (
          <button
            onClick={handleNavigateClick}
            className='mt-2 flex w-full items-center justify-center rounded-lg bg-blue-500 px-4 py-2 font-semibold text-white hover:bg-blue-600'
          >
            <FolderIcon size={20} className='mr-2' />
            Open
          </button>
        )}
        <PopoverPanel className='w-fit-content absolute right-0 top-0 divide-y divide-gray-200 rounded-xl bg-white text-sm/6 ring-1 ring-gray-200 transition duration-200 ease-in-out [--anchor-gap:var(--spacing-5)] data-[closed]:-translate-y-1 data-[closed]:opacity-0'>
          <div className='flex w-40 flex-col gap-2 p-3'>
            <span
              className='flex items-center gap-2 font-semibold text-gray-800'
              onClick={handleDownloadClick}
              role='button'
              tabIndex={0}
              onKeyDown={handleDownloadKeyDown}
            >
              <DownloadIcon size={16} />
              <span>Download</span>
            </span>

            {type === 'folder' && (
              <span
                role='button'
                tabIndex={0}
                onKeyDown={handleNavigateKeyDown}
                className='flex items-center gap-2 font-semibold text-gray-800'
                onClick={handleNavigateClick}
              >
                <FolderIcon size={16} />
                <span>Open</span>
              </span>
            )}
          </div>
        </PopoverPanel>
      </div>
    </Popover>
  );
};
