"use client";

import {
  OwnerRole,
  UploadedObjectMetadata,
} from "@/models/UploadedObjectMetadata";
import { ApiService } from "@/services/api";
import {
  Checkbox,
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from "@headlessui/react";
import { Square, SquareCheck } from "lucide-react";
import {
  ChangeEvent,
  FC,
  Fragment,
  MouseEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { Metadata } from "../../Files/Metadata";
import { ObjectShareModal } from "../../Files/ObjectShareModal";
import bytes from "bytes";
import { ObjectDeleteModal } from "../../Files/ObjectDeleteModal";
import { getTypeFromMetadata, handleFileDownload } from "../../../utils/file";
import { OffchainMetadata } from "@autonomys/auto-drive";
import { ObjectDownloadModal } from "../../Files/ObjectDownloadModal";
import toast from "react-hot-toast";
import { shortenString } from "../../../utils/misc";
import { useUserStore } from "../../../states/user";
import { Table } from "../Table";
import { TableHead, TableHeadCell, TableHeadRow } from "../Table/TableHead";
import { TableBody, TableBodyCell, TableBodyRow } from "../Table/TableBody";
import { DisplayerIcon } from "../Triangle";
import { Button } from "../Button";

export const FileTable: FC<{ files: UploadedObjectMetadata[] }> = ({
  files,
}) => {
  const user = useUserStore(({ user }) => user);
  const [downloadingCID, setDownloadingCID] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [shareCID, setShareCID] = useState<string | null>(null);
  const [deleteCID, setDeleteCID] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<
    {
      type: "file" | "folder";
      cid: string;
      name?: string;
      totalSize: number;
    }[]
  >([]);

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

  const renderOwnerBadge = useCallback(
    (owner: string) => {
      if (owner === user?.publicId) {
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
            {shortenString(owner.slice(1), 15)}
          </span>
        );
      }
    },
    [user?.publicId]
  );

  const downloadFile = useCallback(
    async (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      setDownloadingCID(cid);
    },
    []
  );

  const onDeleteFile = useCallback(
    (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      setDeleteCID(cid);
    },
    []
  );

  const shareFile = useCallback(
    (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      setShareCID(cid);
    },
    []
  );

  const navigateToFile = useCallback((cid: string) => {
    window.location.assign(`/drive/fs/${cid}`);
  }, []);

  const toggleSelectFile = useCallback(
    (
      event: ChangeEvent<HTMLInputElement>,
      entry: {
        type: "file" | "folder";
        cid: string;
        name?: string;
        totalSize: number;
      }
    ) => {
      event.stopPropagation();
      if (selectedFiles.some((f) => f.cid === entry.cid)) {
        setSelectedFiles(selectedFiles.filter((f) => f.cid !== entry.cid));
      } else {
        setSelectedFiles([...selectedFiles, entry]);
      }
    },
    [selectedFiles]
  );

  const renderRow = useCallback(
    (file: UploadedObjectMetadata) => {
      const isExpanded = expandedRows.has(file.metadata.dataCid);
      const owner = file.owners.find(
        (o) => o.role === OwnerRole.ADMIN
      )?.publicId;
      const popoverButtonRef = useRef<HTMLButtonElement>(null);
      const isOwner = user?.publicId === owner;
      const [showDownloadTooltip, setShowDownloadTooltip] = useState(false);
      const hasFileOwnership = file.owners.find(
        (e) => e.publicId === user?.publicId
      );

      return (
        <Fragment key={file.metadata.dataCid}>
          <TableBodyRow
            className={
              file.metadata.type === "folder" ? "hover:cursor-pointer" : ""
            }
            onClick={() =>
              file.metadata.type === "folder" &&
              navigateToFile(file.metadata.dataCid)
            }
          >
            <TableBodyCell className="whitespace-nowrap text-sm text-gray-500">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedFiles.some(
                    (f) => f.cid === file.metadata.dataCid
                  )}
                  onChange={(e) =>
                    toggleSelectFile(e, {
                      type: file.metadata.type,
                      cid: file.metadata.dataCid,
                      name: file.metadata.name,
                      totalSize: file.metadata.totalSize,
                    })
                  }
                  className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
                  onClick={(e) => e.stopPropagation()}
                >
                  <Popover
                    onMouseEnter={() => popoverButtonRef.current?.click()}
                    onMouseLeave={() => popoverButtonRef.current?.click()}
                  >
                    <PopoverButton ref={popoverButtonRef} as="span">
                      <span className="hover:cursor-pointer text-accent font-semibold">
                        {file.metadata.name
                          ? shortenString(file.metadata.name, 30)
                          : `No name (${file.metadata.dataCid.slice(0, 12)})`}
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
                      <PopoverPanel className="absolute z-10 left-0">
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
            <TableBodyCell className="flex justify-end">
              <div
                className="relative"
                onMouseEnter={() => setShowDownloadTooltip(true)}
                onMouseLeave={() => setShowDownloadTooltip(false)}
              >
                <Button
                  variant="lightAccent"
                  className="mr-2 text-xs outline-none focus:ring-0"
                  disabled={file.uploadStatus.totalNodes === null}
                  onClick={(e) => downloadFile(e, file.metadata.dataCid)}
                >
                  Download
                </Button>
                <Transition
                  show={showDownloadTooltip}
                  as={Fragment}
                  enter="transition ease-out delay-250"
                  enterFrom="opacity-0 translate-y-1"
                  enterTo="opacity-100 translate-y-0"
                  leave="transition ease-in duration-300"
                  leaveFrom="opacity-100 translate-y-0"
                  leaveTo="opacity-0 translate-y-1"
                >
                  <div className="absolute z-10 left-0 bottom-0 translate-y-full">
                    {file.uploadStatus.totalNodes === null && (
                      <div className="bg-white shadow-md rounded-lg p-2">
                        <span className="text-sm text-gray-700">
                          Processing upload...
                        </span>
                      </div>
                    )}
                  </div>
                </Transition>
              </div>
              <Button
                variant="lightAccent"
                className="mr-2 text-xs disabled:hidden"
                disabled={!isOwner}
                onClick={(e) => shareFile(e, file.metadata.dataCid)}
              >
                Share
              </Button>
              <Button
                variant="lightDanger"
                className="text-xs disabled:hidden"
                disabled={!hasFileOwnership}
                onClick={(e) => onDeleteFile(e, file.metadata.dataCid)}
              >
                Delete
              </Button>
            </TableBodyCell>
          </TableBodyRow>
          {isExpanded &&
            file.metadata.type === "folder" &&
            file.metadata.children &&
            file.metadata.children.map((child) => (
              <TableBodyRow key={child.cid}>
                <TableBodyCell className="w-[50%]">
                  <div className="flex items-center">
                    <input
                      onChange={(e) => toggleSelectFile(e, child)}
                      checked={selectedFiles.some((f) => f.cid === child.cid)}
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
                      {child.name ?? `No name (${child.cid.slice(0, 12)})`}
                    </span>
                  </div>
                </TableBodyCell>
                <TableBodyCell>
                  <span>{child.type === "file" ? "File" : "Folder"}</span>
                </TableBodyCell>
                <TableBodyCell>
                  <span>{bytes(child.totalSize)}</span>
                </TableBodyCell>
                <TableBodyCell>
                  {owner ? renderOwnerBadge(owner) : "Unknown"}
                </TableBodyCell>
                <TableBodyCell>
                  <Button
                    variant="lightAccent"
                    className="text-xs"
                    onClick={(e) => downloadFile(e, child.cid)}
                  >
                    Download
                  </Button>
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
      toggleSelectFile,
      selectedFiles,
      user?.publicId,
    ]
  );

  const onClose = useCallback(() => {
    setShareCID(null);
    setDeleteCID(null);
    setDownloadingCID(null);
  }, []);

  return (
    <div className="flex flex-col">
      <ObjectShareModal cid={shareCID} closeModal={() => setShareCID(null)} />
      <ObjectDeleteModal
        cid={deleteCID}
        closeModal={() => setDeleteCID(null)}
      />
      <ObjectDownloadModal cid={downloadingCID} onClose={onClose} />
      <div className="-my-2 sm:-mx-6 lg:-mx-8">
        <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
          <div className="flex justify-start items-center mb-4 gap-2 ml-2">
            <div className="h-8 flex items-center">
              <Checkbox
                className="hover:cursor-pointer hover:scale-105 transition-all duration-200"
                checked={selectedFiles.length > 0}
                onChange={() =>
                  selectedFiles.length > 0
                    ? setSelectedFiles([])
                    : setSelectedFiles(
                        files.map((f) => ({
                          type: f.metadata.type,
                          cid: f.metadata.dataCid,
                          name: f.metadata.name,
                          totalSize: f.metadata.totalSize,
                        }))
                      )
                }
              >
                {selectedFiles.length > 0 ? <SquareCheck /> : <Square />}
              </Checkbox>
            </div>
            <Transition
              show={selectedFiles.length > 0}
              enter="transition ease-out duration-100"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition ease-in duration-75"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="contents">
                <span className="text-sm font-semibold">
                  {selectedFiles.length} files selected
                </span>
                <Button className="text-xs" variant="lightAccent">
                  Download
                </Button>
              </div>
            </Transition>
          </div>
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Root CID</TableHeadCell>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell>Size</TableHeadCell>
                <TableHeadCell>Owner</TableHeadCell>
                <TableHeadCell className="text-right">Actions</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>{files.map((file) => renderRow(file))}</TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};
