"use client";

import {
  OwnerRole,
  UploadedObjectMetadata,
} from "@/models/UploadedObjectMetadata";
import { ApiService } from "@/services/api";
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from "@headlessui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FC, Fragment, MouseEvent, useCallback, useState } from "react";
import { Metadata } from "../../Files/Metadata";
import { ObjectShareModal } from "../../Files/ObjectShareModal";
import bytes from "bytes";
import { ObjectDeleteModal } from "../../Files/ObjectDeleteModal";

export const FileTable: FC<{ files: UploadedObjectMetadata[] }> = ({
  files,
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [shareCID, setShareCID] = useState<string | null>(null);
  const [deleteCID, setDeleteCID] = useState<string | null>(null);

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
          {owner.slice(1)}
        </span>
      );
    } else {
      return (
        <span className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-200 rounded-full">
          {owner}
        </span>
      );
    }
  }, []);

  const downloadFile = useCallback(
    (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      window.open(ApiService.fetchDataURL(cid), "_blank");
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

  const renderRow = useCallback(
    (file: UploadedObjectMetadata) => {
      const isExpanded = expandedRows.has(file.metadata.dataCid);
      const owner = file.owners.find((o) => o.role === OwnerRole.ADMIN)?.handle;

      return (
        <Fragment key={file.metadata.dataCid}>
          <tr
            className={`hover:bg-gray-100 relative ${
              file.metadata.type === "folder" ? "hover:cursor-pointer" : ""
            }`}
            onClick={() =>
              file.metadata.type === "folder" &&
              navigateToFile(file.metadata.dataCid)
            }
          >
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              <div className="flex items-center">
                <input
                  type="checkbox"
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
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                )}
                <span className="ml-2">
                  {renderFileIcon(file.metadata.type)}
                </span>
                <span
                  className={`relative ml-2 text-sm font-medium text-gray-900 ${
                    file.metadata.type === "folder"
                      ? "hover:underline hover:cursor-pointer"
                      : ""
                  }`}
                >
                  <Popover>
                    <PopoverButton as="span">
                      <span
                        className="hover:cursor-pointer"
                        onMouseEnter={(e) => e.currentTarget.click()}
                        onMouseLeave={(e) => e.currentTarget.click()}
                      >
                        {file.metadata.name ??
                          `No name (${file.metadata.dataCid.slice(0, 12)})`}
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
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {file.metadata.type}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {bytes(file.metadata.totalSize)}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {owner ? renderOwnerBadge(owner) : "Unknown"}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
              <button
                className="text-white bg-gray-500 hover:bg-gray-600 px-3 py-1 rounded mr-2"
                onClick={(e) => downloadFile(e, file.metadata.dataCid)}
              >
                Download
              </button>
              <button
                className="text-white bg-gray-500 hover:bg-gray-600 px-3 py-1 rounded mr-2"
                onClick={(e) => shareFile(e, file.metadata.dataCid)}
              >
                Share
              </button>
              <button
                className="text-white bg-gray-500 hover:bg-gray-600 px-3 py-1 rounded"
                onClick={(e) => setDeleteCID(file.metadata.dataCid)}
              >
                Delete
              </button>
            </td>
          </tr>
          {isExpanded &&
            file.metadata.type === "folder" &&
            file.metadata.children &&
            file.metadata.children.map((child) => (
              <tr key={child.cid} className="bg-gray-200 ml-40">
                <td className="px-6 py-4 whitespace-nowrap w-[50%]">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />

                    <span
                      className={`relative ml-2 text-sm font-medium text-gray-900 ${
                        file.metadata.type === "folder"
                          ? "hover:underline hover:cursor-pointer"
                          : ""
                      }`}
                    >
                      {child.name ?? `No name (${child.cid.slice(0, 12)})`}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-500">{child.type}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-500">
                    {bytes(child.totalSize)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {owner ? renderOwnerBadge(owner) : "Unknown"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {child.type === "file" && (
                    <button
                      className="text-white bg-gray-500 hover:bg-gray-600 px-3 py-1 rounded mr-2"
                      onClick={(e) => downloadFile(e, child.cid)}
                    >
                      Download
                    </button>
                  )}
                </td>
              </tr>
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
    ]
  );

  return (
    <div className="flex flex-col">
      <ObjectShareModal cid={shareCID} closeModal={() => setShareCID(null)} />
      <ObjectDeleteModal
        cid={deleteCID}
        closeModal={() => setDeleteCID(null)}
      />
      <div className="-my-2 sm:-mx-6 lg:-mx-8">
        <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
          <div className="shadow border-b border-gray-200 sm:rounded-lg">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Root CID
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Type
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Size
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Owner
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>{files.map((file) => renderRow(file))}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
