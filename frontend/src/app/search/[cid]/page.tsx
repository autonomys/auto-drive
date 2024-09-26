"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiService } from "../../../services/api";
import { FileCard } from "../../../components/common/FileCard";
import { UploadedObjectMetadata } from "../../../models/UploadedObjectMetadata";

export default function Page({ params: { cid } }: { params: { cid: string } }) {
  const [objectsMetadata, setObjectsMetadata] =
    useState<UploadedObjectMetadata[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    ApiService.searchHeadCID(cid)
      .then((e) =>
        Promise.all(e.map((e) => ApiService.fetchUploadedObjectMetadata(e)))
      )
      .then(setObjectsMetadata)
      .catch(() => {
        setError("Error searching for objects");
      });
  }, [cid]);

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

    return objectsMetadata.map(({ metadata, uploadStatus }) => {
      switch (metadata.type) {
        case "folder":
          return (
            <a
              key={metadata.dataCid}
              href={`/fs/${metadata.dataCid}`}
              className="contents"
            >
              <FileCard metadata={metadata} uploadStatus={uploadStatus} />
            </a>
          );
        case "file":
          return (
            <a
              key={metadata.dataCid}
              href={`/fs/${metadata.dataCid}`}
              className="contents"
            >
              <FileCard metadata={metadata} uploadStatus={uploadStatus} />
            </a>
          );
      }
    });
  }, [error, objectsMetadata]);

  return <div className="grid grid-cols-4 gap-4">{Content}</div>;
}
