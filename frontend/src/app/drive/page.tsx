"use client";

import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { FileTable } from "../../components/common/FileTable";
import { FileDropZone } from "../../components/Files/FileDropZone";
import { NoUploadsPlaceholder } from "../../components/Files/NoUploadsPlaceholder";
import { UploadingObjects } from "../../components/Files/UploadingObjects";
import { UploadedObjectMetadata } from "../../models/UploadedObjectMetadata";
import { ApiService } from "../../services/api";

export default function Page() {
  const [rootObjectMetadata, setRootObjectMetadata] =
    useState<UploadedObjectMetadata[]>();
  const [scope, setScope] = useLocalStorage<"user" | "global">(
    "search-scope",
    "global"
  );

  useEffect(() => {
    ApiService.getRootObjects(scope).then((e) => {
      const promises = e.map((e) => ApiService.fetchUploadedObjectMetadata(e));
      Promise.all(promises).then(setRootObjectMetadata);
    });
  }, [scope]);

  return (
    <div className="flex w-full">
      <div className="w-full flex flex-col gap-4">
        <FileDropZone />
        <div className="">
          <UploadingObjects />
          {rootObjectMetadata && rootObjectMetadata.length > 0 && (
            <FileTable files={rootObjectMetadata} />
          )}
          {rootObjectMetadata && rootObjectMetadata.length === 0 && (
            <NoUploadsPlaceholder />
          )}
        </div>
      </div>
    </div>
  );
}
