'use client';

import bytes from 'bytes';
import { ApiService } from '@/services/api';
import { FileIcon, FolderIcon, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import {
  UploadedObjectMetadata,
  UploadStatus,
} from '../../models/UploadedObjectMetadata';
import { ObjectShareModal } from './ObjectShareModal';
import { handleEscape } from '../../utils/eventHandler';
import { useGetMetadataByHeadCidQuery } from '../../../gql/graphql';
import { mapObjectInformationFromQueryResult } from '../../services/gql/utils';
import { gqlClient } from '../../services/gql';

export const UploadingObjects = () => {
  const [uploadingObjects] = useLocalStorage<string[]>('uploading-objects', []);
  const [uploadingObjectsMetadata, setUploadingObjectsMetadata] =
    useState<UploadedObjectMetadata[]>();

  useEffect(() => {
    // TODO: reimplement this without using local storage
    Promise.all(
      uploadingObjects.map((cid) =>
        ApiService.fetchUploadedObjectMetadata(cid),
      ),
    ).then((metadata) => {
      setUploadingObjectsMetadata(metadata);
    });
  }, [uploadingObjects]);

  return (
    <div>
      {uploadingObjectsMetadata?.map(({ metadata, uploadStatus, owners }) => (
        <UploadingObject
          key={metadata.dataCid}
          metadata={metadata}
          uploadStatus={uploadStatus}
          owners={owners}
        />
      ))}
    </div>
  );
};

const UploadingObject = ({
  metadata,
  uploadStatus: initialUploadStatus,
}: UploadedObjectMetadata) => {
  const [uploadStatus, setUploadStatus] =
    useState<UploadStatus>(initialUploadStatus);
  const [isHovered, setIsHovered] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [, setUploadingObjects] = useLocalStorage<string[]>(
    'uploading-objects',
    [],
  );
  const [shareCid, setShareCid] = useState<string | null>(null);

  const progress = useMemo(() => {
    return (uploadStatus.uploadedNodes / uploadStatus.totalNodes) * 100;
  }, [uploadStatus]);

  useGetMetadataByHeadCidQuery({
    variables: {
      headCid: metadata.dataCid ?? '',
    },
    onCompleted: (data) => {
      setUploadStatus(mapObjectInformationFromQueryResult(data).uploadStatus);
    },
    onError: (error) => {
      console.error('error', error);
    },
    pollInterval: 5_000,
  });

  useEffect(() => {
    if (uploadStatus.uploadedNodes === uploadStatus.totalNodes) {
      setUploadingObjects((prev) =>
        prev.filter((cid) => cid !== metadata.dataCid),
      );
    }
  }, [
    uploadStatus.uploadedNodes,
    uploadStatus.totalNodes,
    setUploadingObjects,
    metadata.dataCid,
  ]);

  const handleClose = useCallback(() => {
    setIsClosed(true);
  }, []);

  const hasBeenUploaded =
    uploadStatus.uploadedNodes === uploadStatus.totalNodes;

  const onShare = useCallback(() => {
    setShareCid(metadata.dataCid);
  }, [metadata.dataCid]);

  const onClose = useCallback(() => {
    setShareCid(null);
  }, []);

  if (isClosed) {
    return null;
  }

  return (
    <div className='mx-auto p-4'>
      <div className='relative rounded-lg border border-blue-300 p-4'>
        <div className='mb-4 flex items-start'>
          <div className='mr-3 rounded bg-gray-200 p-2'>
            {metadata.type === 'file' ? <FileIcon /> : <FolderIcon />}
          </div>
          <div>
            <p className='font-semibold'>{metadata.name}</p>
            <p className='text-sm text-gray-500'>
              Size: {bytes(Number(metadata.totalSize))}
            </p>
            <p className='text-sm text-gray-500'>Fees: 0 ATC</p>
          </div>
        </div>
        <div className='mb-4'>
          {!hasBeenUploaded ? (
            <p className='mb-1 text-sm font-semibold'>
              Uploading ({progress.toFixed(2)}%)
            </p>
          ) : (
            <p className='mb-1 text-sm font-semibold'>Uploaded</p>
          )}
          <div className='h-2 rounded-full bg-gray-200'>
            <div
              className={`${
                hasBeenUploaded ? 'bg-green-500' : 'bg-blue-500'
              } h-2 rounded-full transition-all duration-300 ease-in-out`}
              style={{ width: `${progress.toFixed(2)}%` }}
            ></div>
          </div>
        </div>
        <div className='flex space-x-2'>
          <ObjectShareModal closeModal={onClose} cid={shareCid} />
          <button
            className='rounded bg-gray-300 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-400'
            onClick={onShare}
          >
            Share
          </button>
        </div>
        <div
          role='button'
          tabIndex={0}
          onKeyDown={handleEscape(handleClose)}
          className='absolute right-2 top-2 cursor-pointer'
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={handleClose}
        >
          <X
            className={`h-5 w-5 ${
              isHovered ? 'text-red-500' : 'text-gray-400'
            }`}
          />
        </div>
      </div>
    </div>
  );
};
