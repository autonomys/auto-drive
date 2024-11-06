'use client';

import { FileCard } from '@/components/common/FileCard';
import { UploadedObjectMetadata } from '@/models/UploadedObjectMetadata';
import { ApiService } from '@/services/api';
import { useEffect, useMemo, useState } from 'react';
import { useScopeStore } from '../../../../states/scope';

export default function Page({ params: { cid } }: { params: { cid: string } }) {
  const [objectsMetadata, setObjectsMetadata] =
    useState<UploadedObjectMetadata[]>();
  const [error, setError] = useState<string>();
  const scope = useScopeStore(({ scope }) => scope);

  useEffect(() => {
    ApiService.searchByCIDOrName(cid, scope)
      .then((e) =>
        Promise.all(
          e.map((e) => ApiService.fetchUploadedObjectMetadata(e.cid)),
        ),
      )
      .then(setObjectsMetadata)
      .catch(() => {
        setError('Error searching for objects');
      });
  }, [cid, scope]);

  const Content = useMemo(() => {
    if (error) {
      return (
        <div className='flex h-[50%] w-full flex-col items-center justify-center text-center text-xl text-red-500'>
          {error}
        </div>
      );
    }

    if (!objectsMetadata) {
      return (
        <div className='flex h-[50%] w-full flex-col items-center justify-center text-center text-xl text-gray-500'></div>
      );
    }

    if (objectsMetadata.length === 0) {
      return (
        <div className='flex h-[50%] w-full flex-col items-center justify-center text-center text-xl text-gray-500'>
          No root objects, upload some!
        </div>
      );
    }

    return objectsMetadata.map(({ metadata, uploadStatus }) => (
      <FileCard
        key={metadata.dataCid}
        metadata={metadata}
        uploadStatus={uploadStatus}
      />
    ));
  }, [error, objectsMetadata]);

  return <div className='grid grid-cols-4 gap-4'>{Content}</div>;
}
