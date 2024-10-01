"use client";

import { ApiService } from "@/services/api";
import { CrossIcon, FileIcon, FolderIcon, TrashIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInterval, useLocalStorage, useTimeout } from "usehooks-ts";
import {
  UploadedObjectMetadata,
  UploadStatus,
} from "../../models/UploadedObjectMetadata";

export const UploadingObjects = () => {
  const [uploadingObjects] = useLocalStorage<string[]>("uploading-objects", []);
  const [uploadingObjectsMetadata, setUploadingObjectsMetadata] =
    useState<UploadedObjectMetadata[]>();

  useEffect(() => {
    Promise.all(
      uploadingObjects.map((cid) => ApiService.fetchUploadedObjectMetadata(cid))
    ).then((metadata) => {
      setUploadingObjectsMetadata(metadata);
    });
  }, []);

  return (
    <div>
      {uploadingObjectsMetadata?.map(({ metadata, uploadStatus }) => (
        <UploadingObject
          key={metadata.dataCid}
          metadata={metadata}
          uploadStatus={uploadStatus}
        />
      ))}
    </div>
  );
};

const UploadingObject = ({
  metadata,
  uploadStatus: initialUploadStatus,
}: UploadedObjectMetadata) => {
  const [uploadStatus, setUploadStatus] =
    useState<UploadStatus>(initialUploadStatus);
  const [isHovered, setIsHovered] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [, setUploadingObjects] = useLocalStorage<string[]>(
    "uploading-objects",
    []
  );

  const progress = useMemo(() => {
    return (
      (uploadStatus.uploadedNodes /
        (uploadStatus.nodesToBeUploaded + uploadStatus.uploadedNodes)) *
      100
    );
  }, [uploadStatus, metadata]);

  useInterval(() => {
    ApiService.fetchUploadedObjectMetadata(metadata.dataCid).then(
      (metadata) => {
        setUploadStatus(metadata.uploadStatus);
      }
    );
  }, 5_000);

  useEffect(() => {
    if (uploadStatus.nodesToBeUploaded === 0) {
      setUploadingObjects((prev) =>
        prev.filter((cid) => cid !== metadata.dataCid)
      );
    }
  }, [uploadStatus.nodesToBeUploaded]);

  const handleClose = useCallback(() => {
    setIsClosed(true);
  }, [metadata.dataCid]);

  if (isClosed) {
    return null;
  }

  return (
    <div className="mx-auto p-4">
      <div className="border border-blue-300 rounded-lg p-4 relative">
        <div className="flex items-start mb-4">
          <div className="bg-gray-200 rounded p-2 mr-3">
            {metadata.type === "file" ? <FileIcon /> : <FolderIcon />}
          </div>
          <div>
            <p className="font-semibold">{metadata.name}</p>
            <p className="text-sm text-gray-500">Size: {metadata.totalSize}</p>
            <p className="text-sm text-gray-500">Fees: 0 ATC</p>
          </div>
        </div>
        <div className="mb-4">
          {progress < 100 ? (
            <p className="text-sm font-semibold mb-1">
              Uploading ({progress}%)
            </p>
          ) : (
            <p className="text-sm font-semibold mb-1">Uploaded</p>
          )}
          <div className="bg-gray-200 rounded-full h-2">
            <div
              className={`${
                progress === 100 ? "bg-green-500" : "bg-blue-500"
              } rounded-full h-2 transition-all duration-300 ease-in-out`}
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
        <div className="flex space-x-2">
          <button className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded">
            Share
          </button>
        </div>
        <div
          className="absolute top-2 right-2 cursor-pointer"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={handleClose}
        >
          <X
            className={`w-5 h-5 ${
              isHovered ? "text-red-500" : "text-gray-400"
            }`}
          />
        </div>
      </div>
    </div>
  );
};
