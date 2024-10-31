"use client";

import { FileTable } from "@/components/common/FileTable";
import { FileDropZone } from "@/components/Files/FileDropZone";
import { NoUploadsPlaceholder } from "@/components/Files/NoUploadsPlaceholder";
import { ApiService } from "@/services/api";
import { useCallback, useEffect, useState } from "react";
import { UploadingObjects } from "../../components/Files/UploadingObjects";
import { ObjectSummary } from "../../models/UploadedObjectMetadata";
import { LoaderCircle } from "lucide-react";
import { useScopeStore } from "../../states/scope";
import { PaginatedResult } from "../../models/common";

export default function Page() {
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  const [rootObjectMetadata, setRootObjectMetadata] = useState<
    ObjectSummary[] | null
  >(null);
  const scope = useScopeStore(({ scope }) => scope);

  const updateResult = useCallback((result: PaginatedResult<ObjectSummary>) => {
    setRootObjectMetadata(result.rows);
    setTotalItems(result.totalCount);
  }, []);

  useEffect(() => {
    const offset = currentPage * pageSize;
    setRootObjectMetadata(null);
    ApiService.getRootObjects(scope, offset, pageSize).then(updateResult);
  }, [scope, currentPage, pageSize, updateResult]);

  const updateCurrentPage = useCallback((newPage: number) => {
    setCurrentPage(newPage);
  }, []);

  const updatePageSize = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
  }, []);

  return (
    <div className="flex w-full">
      <div className="w-full flex flex-col gap-4">
        <FileDropZone />
        <div className="">
          <UploadingObjects />
          {rootObjectMetadata === null && (
            <div className="flex min-h-[50vh] justify-center items-center">
              <LoaderCircle className="w-10 h-10 animate-spin" />
            </div>
          )}
          {rootObjectMetadata && rootObjectMetadata.length > 0 && (
            <FileTable
              files={rootObjectMetadata}
              pageSize={pageSize}
              setPageSize={updatePageSize}
              currentPage={currentPage}
              setCurrentPage={updateCurrentPage}
              totalItems={totalItems}
            />
          )}
          {rootObjectMetadata && rootObjectMetadata.length === 0 && (
            <NoUploadsPlaceholder />
          )}
        </div>
      </div>
    </div>
  );
}
