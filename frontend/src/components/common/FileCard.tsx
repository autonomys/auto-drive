"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Popover,
  PopoverButton,
  PopoverPanel,
} from "@headlessui/react";
import {
  Folder,
  File,
  MoreVertical,
  Download,
  Trash,
  Edit,
  Share2,
  DownloadIcon,
  FolderIcon,
} from "lucide-react";
import { ApiService } from "../../services/api";
import { UploadedObjectMetadata } from "../../models/UploadedObjectMetadata";
import { OffchainMetadata } from "@autonomys/auto-drive";

interface FileCardProps extends Partial<UploadedObjectMetadata> {
  icon?: React.ReactNode;
  metadata: OffchainMetadata;
}

export function FileCard({
  metadata: { type, name, totalSize, dataCid },
  uploadStatus,
  icon,
}: FileCardProps) {
  const onDownload = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement | HTMLSpanElement>,
      cid: string
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const url = ApiService.fetchDataURL(cid);
      window.open(url, "_blank");
    },
    []
  );

  const onNavigate = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement | HTMLSpanElement>,
      cid: string
    ) => {
      event.stopPropagation();
      event.preventDefault();
      window.location.assign(`/fs/${cid}`);
    },
    []
  );

  const objectIcon = useMemo(() => {
    if (icon) return icon;
    return type === "folder" ? (
      <Folder className="w-8 h-8 text-blue-500" />
    ) : (
      <File className="w-8 h-8 text-gray-500" />
    );
  }, [icon, type]);

  return (
    <Popover>
      <div className="relative bg-white rounded-lg border border-gray-200 p-4 shadow-sm max-w-sm">
        <div className="flex justify-between items-start mb-4">
          {objectIcon}
          <PopoverButton>
            <MoreVertical size={20} />
          </PopoverButton>
        </div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">{name}</h2>
        <p className="text-gray-500 mb-4">Size: {totalSize}</p>
        {type === "file" && (
          <button
            onClick={(event) => onDownload(event, dataCid)}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center"
          >
            <Download size={20} className="mr-2" />
            Download
          </button>
        )}
        {type === "folder" && (
          <button
            onClick={(event) => onNavigate(event, dataCid)}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center"
          >
            <FolderIcon size={20} className="mr-2" />
            Open
          </button>
        )}
        <PopoverPanel className="absolute top-0 right-0 w-fit-content divide-y divide-gray-200 rounded-xl bg-white text-sm/6 transition duration-200 ring-1 ring-gray-200 ease-in-out [--anchor-gap:var(--spacing-5)] data-[closed]:-translate-y-1 data-[closed]:opacity-0">
          <div className="p-3 flex flex-col gap-2 w-40">
            <span className="flex items-center gap-2 font-semibold text-gray-800">
              <Edit size={16} />
              <span>Edit</span>
            </span>
            <span className="flex items-center gap-2 font-semibold text-gray-800">
              <Share2 size={16} />
              <span>Share</span>
            </span>
            {type === "file" && (
              <span
                className="flex items-center gap-2 font-semibold text-gray-800"
                onClick={(event) => onDownload(event, dataCid)}
              >
                <DownloadIcon size={16} />
                <span>Download</span>
              </span>
            )}

            {type === "folder" && (
              <span
                className="flex items-center gap-2 font-semibold text-gray-800"
                onClick={(event) => onNavigate(event, dataCid)}
              >
                <FolderIcon size={16} />
                <span>Open</span>
              </span>
            )}
          </div>
        </PopoverPanel>
      </div>
    </Popover>
  );
}
