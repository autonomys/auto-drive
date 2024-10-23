"use client";

import { FileTable } from "@/components/common/FileTable";
import { FileDropZone } from "@/components/Files/FileDropZone";
import { NoUploadsPlaceholder } from "@/components/Files/NoUploadsPlaceholder";
import { ApiService } from "@/services/api";
import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { UploadingObjects } from "../../components/Files/UploadingObjects";
import { UploadedObjectMetadata } from "../../models/UploadedObjectMetadata";
import { LoaderCircle } from "lucide-react";
import { useScopeStore } from "../../states/scope";

export default function Page() {
  const [rootObjectMetadata, setRootObjectMetadata] = useState<
    UploadedObjectMetadata[] | null
  >(null);
  const scope = useScopeStore(({ scope }) => scope);

  useEffect(() => {
    setRootObjectMetadata(null);
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
          {rootObjectMetadata === null && (
            <div className="flex min-h-[50vh] justify-center items-center">
              <LoaderCircle className="w-10 h-10 animate-spin" />
            </div>
          )}
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
