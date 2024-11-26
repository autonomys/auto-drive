'use client';

import { UploadedObjectMetadata } from '@/models/UploadedObjectMetadata';
import { ApiService } from '@/services/api';
import { useEffect, useState } from 'react';
import { useScopeStore } from '../../../../states/scope';
import { SearchResult } from '../../../../views/SearchResult';

export default function Page({ params: { cid } }: { params: { cid: string } }) {
  const [objectsMetadata, setObjectsMetadata] =
    useState<UploadedObjectMetadata[]>();
  const scope = useScopeStore(({ scope }) => scope);

  useEffect(() => {
    ApiService.searchByCIDOrName(cid, scope)
      .then((e) =>
        Promise.all(
          e.map((e) => ApiService.fetchUploadedObjectMetadata(e.cid)),
        ),
      )
      .then(setObjectsMetadata);
  }, [cid, scope]);

  return <SearchResult objects={objectsMetadata ?? []} />;
}
