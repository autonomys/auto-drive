"use client";

import { ApiService } from "@/services/api";
import { useCallback, useEffect, useState } from "react";
import { ObjectSummary } from "../../../models/UploadedObjectMetadata";
import { TrashFiles } from "../../../components/TrashFiles";
import { PaginatedResult } from "../../../models/common";

export default function Page() {
  const [rootObjectMetadata, setRootObjectMetadata] = useState<
    ObjectSummary[] | null
  >(null);
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  const updateResult = useCallback((result: PaginatedResult<ObjectSummary>) => {
    setRootObjectMetadata(result.rows);
    setTotalItems(result.totalCount);
  }, []);

  useEffect(() => {
    setRootObjectMetadata(null);
    ApiService.getTrashObjects(currentPage * pageSize, pageSize).then(
      updateResult
    );
  }, [currentPage, pageSize, updateResult]);

  const updatePageSize = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
  }, []);

  const updateCurrentPage = useCallback((newCurrentPage: number) => {
    setCurrentPage(newCurrentPage);
  }, []);

  return (
    <TrashFiles
      objects={rootObjectMetadata}
      pageSize={pageSize}
      setPageSize={updatePageSize}
      currentPage={currentPage}
      setCurrentPage={updateCurrentPage}
      totalItems={totalItems}
    />
  );
}
