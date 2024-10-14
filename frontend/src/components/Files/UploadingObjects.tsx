"use client";

import bytes from "bytes";
import { ApiService } from "@/services/api";
import { FileIcon, FolderIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInterval, useLocalStorage } from "usehooks-ts";
import {
  UploadedObjectMetadata,
  UploadStatus,
} from "../../models/UploadedObjectMetadata";
import { ObjectShareModal } from "./ObjectShareModal";

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
      {uploadingObjectsMetadata?.map(({ metadata, uploadStatus, owners }) => (
        <UploadingObject
          key={metadata.dataCid}
          metadata={metadata}
          uploadStatus={uploadStatus}
          owners={owners}
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
  const [shareCid, setShareCid] = useState<string | null>(null);

  const progress = useMemo(() => {
    return (uploadStatus.uploadedNodes / uploadStatus.totalNodes) * 100;
  }, [uploadStatus, metadata]);

  useInterval(() => {
    ApiService.fetchUploadedObjectMetadata(metadata.dataCid).then(
      (metadata) => {
        setUploadStatus(metadata.uploadStatus);
      }
    );
  }, 5_000);

  useEffect(() => {
    if (uploadStatus.uploadedNodes === uploadStatus.totalNodes) {
      setUploadingObjects((prev) =>
        prev.filter((cid) => cid !== metadata.dataCid)
      );
    }
  }, [uploadStatus.uploadedNodes, uploadStatus.totalNodes]);

  const handleClose = useCallback(() => {
    setIsClosed(true);
  }, [metadata.dataCid]);

  const hasBeenUploaded =
    uploadStatus.uploadedNodes === uploadStatus.totalNodes;

  const onShare = useCallback(() => {
    setShareCid(metadata.dataCid);
  }, [metadata.dataCid]);

  const onClose = useCallback(() => {
    setShareCid(null);
  }, []);

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
            <p className="text-sm text-gray-500">
              Size: {bytes(metadata.totalSize)}
            </p>
            <p className="text-sm text-gray-500">Fees: 0 ATC</p>
          </div>
        </div>
        <div className="mb-4">
          {!hasBeenUploaded ? (
            <p className="text-sm font-semibold mb-1">
              Uploading ({progress.toFixed(2)}%)
            </p>
          ) : (
            <p className="text-sm font-semibold mb-1">Uploaded</p>
          )}
          <div className="bg-gray-200 rounded-full h-2">
            <div
              className={`${
                hasBeenUploaded ? "bg-green-500" : "bg-blue-500"
              } rounded-full h-2 transition-all duration-300 ease-in-out`}
              style={{ width: `${progress.toFixed(2)}%` }}
            ></div>
          </div>
        </div>
        <div className="flex space-x-2">
          <ObjectShareModal closeModal={onClose} cid={shareCid} />
          <button
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded"
            onClick={onShare}
          >
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
