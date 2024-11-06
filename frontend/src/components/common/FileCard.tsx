'use client';

import bytes from 'bytes';
import { OffchainMetadata } from '@autonomys/auto-drive';
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
import { UploadedObjectMetadata } from '../../models/UploadedObjectMetadata';
import { ObjectDownloadModal } from '../Files/ObjectDownloadModal';

interface FileCardProps extends Partial<UploadedObjectMetadata> {
  icon?: React.ReactNode;
  metadata: OffchainMetadata;
}

export const FileCard = ({
  metadata: { type, name, totalSize, dataCid },
  icon,
}: FileCardProps) => {
  const router = useRouter();
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  const onDownload = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement | HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDownloadModalOpen(true);
    },
    [],
  );

  const onNavigate = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement | HTMLSpanElement>,
      cid: string,
    ) => {
      event.stopPropagation();
      event.preventDefault();
      router.push(`/drive/fs/${cid}`);
    },
    [router],
  );

  const objectIcon = useMemo(() => {
    if (icon) return icon;
    return type === 'folder' ? (
      <Folder className='h-8 w-8 text-blue-500' />
    ) : (
      <File className='h-8 w-8 text-gray-500' />
    );
  }, [icon, type]);

  return (
    <Popover className='flex flex-1 flex-col'>
      <ObjectDownloadModal
        cid={isDownloadModalOpen ? dataCid : null}
        onClose={() => setIsDownloadModalOpen(false)}
      />
      <div className='relative flex max-w-sm flex-1 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm'>
        <div className='mb-4 flex items-start justify-between'>
          {objectIcon}
          <PopoverButton>
            <MoreVertical size={20} />
          </PopoverButton>
        </div>
        <h2 className='mb-2 text-lg font-semibold text-gray-800'>{name}</h2>
        <p className='mb-4 text-gray-500'>Size: {bytes(totalSize)}</p>
        <button
          onClick={onDownload}
          className='flex w-full items-center justify-center rounded-lg bg-blue-500 px-4 py-2 font-semibold text-white hover:bg-blue-600'
        >
          <Download size={20} className='mr-2' />
          Download
        </button>
        {type === 'folder' && (
          <button
            onClick={(event) => onNavigate(event, dataCid)}
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
              onClick={onDownload}
            >
              <DownloadIcon size={16} />
              <span>Download</span>
            </span>

            {type === 'folder' && (
              <span
                className='flex items-center gap-2 font-semibold text-gray-800'
                onClick={(event) => onNavigate(event, dataCid)}
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
