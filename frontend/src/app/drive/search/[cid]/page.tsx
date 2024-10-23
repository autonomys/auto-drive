"use client";

import { FileCard } from "@/components/common/FileCard";
import { InternalLink } from "@/components/common/InternalLink";
import { UploadedObjectMetadata } from "@/models/UploadedObjectMetadata";
import { ApiService } from "@/services/api";
import { useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { useScopeStore } from "../../../../states/scope";

export default function Page({ params: { cid } }: { params: { cid: string } }) {
  const [objectsMetadata, setObjectsMetadata] =
    useState<UploadedObjectMetadata[]>();
  const [error, setError] = useState<string>();
  const { scope } = useScopeStore();

  useEffect(() => {
    ApiService.searchByCIDOrName(cid, scope)
      .then((e) =>
        Promise.all(e.map((e) => ApiService.fetchUploadedObjectMetadata(e.cid)))
      )
      .then(setObjectsMetadata)
      .catch(() => {
        setError("Error searching for objects");
      });
  }, [cid, scope]);

  const Content = useMemo(() => {
    if (error) {
      return (
        <div className="text-center text-red-500 flex flex-col items-center justify-center h-[50%] w-full text-xl">
          {error}
        </div>
      );
    }

    if (!objectsMetadata) {
      return (
        <div className="text-center text-gray-500 flex flex-col items-center justify-center h-[50%] w-full text-xl"></div>
      );
    }

    if (objectsMetadata.length === 0) {
      return (
        <div className="text-center text-gray-500 flex flex-col items-center justify-center h-[50%] w-full text-xl">
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

  return <div className="grid grid-cols-4 gap-4">{Content}</div>;
}
