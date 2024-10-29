"use client";

import {
  OwnerRole,
  UploadedObjectMetadata,
} from "@/models/UploadedObjectMetadata";
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from "@headlessui/react";
import { FC, Fragment, MouseEvent, useCallback, useRef, useState } from "react";
import { Metadata } from "../../Files/Metadata";
import { ObjectShareModal } from "../../Files/ObjectShareModal";
import bytes from "bytes";
import { ObjectRestoreModal } from "../../Files/ObjectRestoreModal";
import { getTypeFromMetadata } from "../../../utils/file";
import { ObjectDownloadModal } from "../../Files/ObjectDownloadModal";
import { TableBody, TableBodyCell, TableBodyRow } from "../Table/TableBody";
import { shortenString } from "../../../utils/misc";
import { Table } from "../Table";
import { TableHead, TableHeadCell, TableHeadRow } from "../Table/TableHead";
import { DisplayerIcon } from "../Triangle";
import { Button } from "../Button";

export const DeletedFilesTable: FC<{ files: UploadedObjectMetadata[] }> = ({
  files,
}) => {
  const [cid, setCID] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<UploadedObjectMetadata[]>(
    []
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [shareCID, setShareCID] = useState<string | null>(null);
  const [restoreCID, setRestoreCID] = useState<string | null>(null);

  const toggleRow = useCallback(
    (id: string) => {
      const newExpandedRows = new Set(expandedRows);
      if (newExpandedRows.has(id)) {
        newExpandedRows.delete(id);
      } else {
        newExpandedRows.add(id);
      }
      setExpandedRows(newExpandedRows);
    },
    [expandedRows]
  );

  const renderFileIcon = useCallback((type: string) => {
    return <span></span>;
  }, []);

  const renderOwnerBadge = useCallback((owner: string) => {
    if (owner === "You") {
      return (
        <span className="px-2 py-1 text-xs font-semibold text-green-800 bg-green-100 rounded-full">
          You
        </span>
      );
    } else if (owner.startsWith("@")) {
      return (
        <span className="px-2 py-1 text-xs font-semibold text-blue-800 bg-blue-100 rounded-full">
          {shortenString(owner.slice(1), 15)}
        </span>
      );
    } else {
      return (
        <span className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-200 rounded-full">
          {shortenString(owner, 15)}
        </span>
      );
    }
  }, []);

  const downloadFile = useCallback(
    async (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      setCID(cid);
    },
    []
  );

  const openRestoreModal = useCallback(
    (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      setRestoreCID(cid);
    },
    []
  );

  const navigateToFile = useCallback((cid: string) => {
    window.location.assign(`/drive/fs/${cid}`);
  }, []);

  const batchedDownload = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      selectedFiles.forEach((file) => {
        downloadFile(e, file.metadata.dataCid);
      });
    },
    [selectedFiles, downloadFile]
  );

  const renderRow = useCallback(
    (file: UploadedObjectMetadata) => {
      const isExpanded = expandedRows.has(file.metadata.dataCid);
      const owner = file.owners.find(
        (o) => o.role === OwnerRole.ADMIN
      )?.publicId;
      const popoverButtonRef = useRef<HTMLButtonElement>(null);

      return (
        <Fragment key={file.metadata.dataCid}>
          <TableBodyRow
            className={`hover:bg-gray-100 relative ${
              file.metadata.type === "folder" ? "hover:cursor-pointer" : ""
            }`}
            onClick={() =>
              file.metadata.type === "folder" &&
              navigateToFile(file.metadata.dataCid)
            }
          >
            <TableBodyCell>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedFiles([...selectedFiles, file]);
                    } else {
                      setSelectedFiles(selectedFiles.filter((f) => f !== file));
                    }
                  }}
                />
                {file.metadata.type === "folder" && file.metadata.children && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRow(file.metadata.dataCid);
                    }}
                  >
                    {isExpanded ? (
                      <DisplayerIcon className="text-accent rotate-90" />
                    ) : (
                      <DisplayerIcon className="text-black" />
                    )}
                  </button>
                )}
                <span>{renderFileIcon(file.metadata.type)}</span>
                <span
                  className={`relative ml-2 text-sm font-medium text-gray-900 ${
                    file.metadata.type === "folder"
                      ? "hover:underline hover:cursor-pointer"
                      : ""
                  }`}
                  onMouseEnter={(e) => {
                    e.stopPropagation();
                    popoverButtonRef.current?.click();
                  }}
                  onMouseLeave={(e) => {
                    e.stopPropagation();
                    popoverButtonRef.current?.click();
                  }}
                >
                  <Popover>
                    <PopoverButton ref={popoverButtonRef} as="span">
                      <span className="hover:cursor-pointer text-accent font-semibold">
                        {shortenString(
                          file.metadata.name ??
                            `No name (${file.metadata.dataCid.slice(0, 12)})`,
                          35
                        )}
                      </span>
                    </PopoverButton>
                    <Transition
                      as={Fragment}
                      enter="transition ease-out delay-250"
                      enterFrom="opacity-0 translate-y-1"
                      enterTo="opacity-100 translate-y-0"
                      leave="transition ease-in duration-300"
                      leaveFrom="opacity-100 translate-y-0"
                      leaveTo="opacity-0 translate-y-1"
                    >
                      <PopoverPanel
                        className="absolute z-10 left-0"
                        onMouseEnter={(e) => e.currentTarget.click()}
                        onMouseLeave={(e) => e.currentTarget.click()}
                      >
                        <div className="bg-white shadow-md rounded-lg">
                          <Metadata object={file} />
                        </div>
                      </PopoverPanel>
                    </Transition>
                  </Popover>
                </span>
              </div>
            </TableBodyCell>
            <TableBodyCell>{getTypeFromMetadata(file.metadata)}</TableBodyCell>
            <TableBodyCell>{bytes(file.metadata.totalSize)}</TableBodyCell>
            <TableBodyCell>
              {owner ? renderOwnerBadge(owner) : "Unknown"}
            </TableBodyCell>
            <TableBodyCell className="text-right text-sm font-medium flex">
              <Button
                variant="lightAccent"
                className="mr-2 text-xs"
                onClick={(e) => downloadFile(e, file.metadata.dataCid)}
              >
                Download
              </Button>
              <Button
                variant="lightAccent"
                className="mr-2 text-xs"
                onClick={(e) => openRestoreModal(e, file.metadata.dataCid)}
              >
                Restore
              </Button>
            </TableBodyCell>
          </TableBodyRow>
          {isExpanded &&
            file.metadata.type === "folder" &&
            file.metadata.children &&
            file.metadata.children.map((child) => (
              <TableBodyRow key={child.cid}>
                <TableBodyCell className="px-6 py-4 whitespace-nowrap w-[50%]">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    -
                    <span
                      className={`relative ml-2 text-sm font-semibold text-accent ${
                        file.metadata.type === "folder"
                          ? "hover:underline hover:cursor-pointer"
                          : ""
                      }`}
                    >
                      {shortenString(
                        child.name ?? `No name (${child.cid.slice(0, 12)})`,
                        35
                      )}
                    </span>
                  </div>
                </TableBodyCell>
                <TableBodyCell>
                  <span className="text-sm text-gray-500">
                    {child.type === "file" ? "File" : "Folder"}
                  </span>
                </TableBodyCell>
                <TableBodyCell>
                  <span className="text-sm text-gray-500">
                    {bytes(child.totalSize)}
                  </span>
                </TableBodyCell>
                <TableBodyCell>
                  {owner ? renderOwnerBadge(owner) : "Unknown"}
                </TableBodyCell>
                <TableBodyCell className="text-right text-sm font-medium">
                  {child.type === "file" && (
                    <Button
                      variant="lightAccent"
                      className="text-xs"
                      onClick={(e) => downloadFile(e, child.cid)}
                    >
                      Download
                    </Button>
                  )}
                </TableBodyCell>
              </TableBodyRow>
            ))}
        </Fragment>
      );
    },
    [
      expandedRows,
      navigateToFile,
      downloadFile,
      renderOwnerBadge,
      renderFileIcon,
      toggleRow,
      openRestoreModal,
    ]
  );

  const onCloseModal = useCallback(() => {
    setCID(null);
    setShareCID(null);
    setRestoreCID(null);
  }, []);

  return (
    <div className="flex flex-col">
      <ObjectDownloadModal cid={cid ?? null} onClose={onCloseModal} />
      <ObjectShareModal cid={shareCID} closeModal={onCloseModal} />
      <ObjectRestoreModal cid={restoreCID} closeModal={onCloseModal} />
      <Transition
        show={selectedFiles.length > 0}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <div className="flex justify-start items-center mb-4 gap-2 ml-2">
          <span className="text-sm font-semibold">
            {selectedFiles.length} files selected
          </span>
          <Button
            className="text-xs"
            variant="lightAccent"
            onClick={batchedDownload}
          >
            Download
          </Button>
        </div>
      </Transition>
      <div className="-my-2 sm:-mx-6 lg:-mx-8">
        <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
          <div className="shadow border-b border-gray-200 sm:rounded-lg">
            <Table className="min-w-full">
              <TableHead>
                <TableHeadRow>
                  <TableHeadCell>Root CID</TableHeadCell>
                  <TableHeadCell>Type</TableHeadCell>
                  <TableHeadCell>Size</TableHeadCell>
                  <TableHeadCell>Owner</TableHeadCell>
                  <TableHeadCell>Actions</TableHeadCell>
                </TableHeadRow>
              </TableHead>
              <TableBody>{files.map((file) => renderRow(file))}</TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
};
