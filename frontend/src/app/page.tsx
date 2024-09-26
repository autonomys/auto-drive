"use client";

import { useEffect, useState } from "react";
import { ApiService } from "../services/api";
import { useLocalStorage } from "usehooks-ts";
import { UploadedObjectMetadata } from "../models/UploadedObjectMetadata";
import { FileDropZone } from "../components/Files/FileDropZone";
import { FileTable } from "../components/common/FileTable";
import { NoUploadsPlaceholder } from "../components/Files/NoUploadsPlaceholder";

export default function Page() {
  const [localObjectCIDs] = useLocalStorage<string[]>(
    "root-objects-cid-v3",
    []
  );

  const [rootObjectMetadata, setRootObjectMetadata] =
    useState<UploadedObjectMetadata[]>();

  useEffect(() => {
    Promise.all(
      localObjectCIDs.map((e) => ApiService.fetchUploadedObjectMetadata(e))
    ).then(setRootObjectMetadata);
  }, []);

  return (
    <div className="flex w-full">
      <div className="w-full flex flex-col gap-4">
        <FileDropZone />
        <div className="">
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
