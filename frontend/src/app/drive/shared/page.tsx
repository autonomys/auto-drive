'use client';

import { ApiService } from '@/services/api';
import { useCallback, useEffect, useState } from 'react';
import { ObjectSummary } from '../../../models/UploadedObjectMetadata';
import { SharedFiles } from '../../../components/SharedFiles';
import { PaginatedResult } from '../../../models/common';

export default function Page() {
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  const [rootObjectMetadata, setRootObjectMetadata] = useState<
    ObjectSummary[] | null
  >(null);

  const updateResult = useCallback((result: PaginatedResult<ObjectSummary>) => {
    setRootObjectMetadata(result.rows);
    setTotalItems(result.totalCount);
  }, []);

  useEffect(() => {
    setRootObjectMetadata(null);
    const offset = currentPage * pageSize;
    ApiService.getSharedRoots(offset, pageSize).then(updateResult);
  }, [currentPage, pageSize, updateResult]);

  return (
    <SharedFiles
      objects={rootObjectMetadata}
      pageSize={pageSize}
      setPageSize={setPageSize}
      currentPage={currentPage}
      setCurrentPage={setCurrentPage}
      totalItems={totalItems}
    />
  );
}
