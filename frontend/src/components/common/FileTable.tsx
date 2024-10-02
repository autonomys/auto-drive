"use client";

import { UploadedObjectMetadata } from "@/models/UploadedObjectMetadata";
import { ApiService } from "@/services/api";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import React, { FC, Fragment, useCallback, useState } from "react";

export const FileTable: FC<{ files: UploadedObjectMetadata[] }> = ({
  files,
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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
    } else if (owner.startsWith("0x")) {
      return (
        <span className="px-2 py-1 text-xs font-semibold text-blue-800 bg-blue-100 rounded-full">
          {owner}
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

  const downloadFile = useCallback((cid: string) => {
    window.open(ApiService.fetchDataURL(cid), "_blank");
  }, []);

  const navigateToFile = useCallback((cid: string) => {
    window.location.assign(`/drive/fs/${cid}`);
  }, []);

  const renderRow = useCallback(
    (file: UploadedObjectMetadata, level: number = 0) => {
      const isExpanded = expandedRows.has(file.metadata.dataCid);

      return (
        <Fragment key={file.metadata.dataCid}>
          <tr className="hover:bg-gray-100">
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {file.metadata.type === "folder" && file.metadata.children && (
                  <button
                    onClick={() => toggleRow(file.metadata.dataCid)}
                    className="mr-2"
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
                  className={`ml-2 text-sm font-medium text-gray-900 ${
                    file.metadata.type === "folder"
                      ? "hover:underline hover:cursor-pointer"
                      : ""
                  }`}
                  onClick={() =>
                    file.metadata.type === "folder"
                      ? navigateToFile(file.metadata.dataCid)
                      : null
                  }
                >
                  {file.metadata.dataCid}
                </span>
              </div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {file.metadata.type}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {file.metadata.totalSize}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {renderOwnerBadge("You")}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
              <button
                className="text-white bg-gray-500 hover:bg-gray-600 px-3 py-1 rounded mr-2"
                onClick={() => downloadFile(file.metadata.dataCid)}
              >
                Download
              </button>
            </td>
          </tr>
          {isExpanded &&
            file.metadata.type === "folder" &&
            file.metadata.children &&
            file.metadata.children.map((child) => (
              <tr key={child.cid} className="bg-gray-200 ml-40">
                <td className="px-6 py-4 whitespace-nowrap w-[50%]">
                  <input
                    type="checkbox"
                    className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span
                    className={`ml-2 text-sm font-medium text-gray-900 ${
                      child.type === "folder"
                        ? "hover:underline hover:cursor-pointer"
                        : ""
                    }`}
                    onClick={() =>
                      child.type === "folder" ? navigateToFile(child.cid) : null
                    }
                  >
                    {child.cid}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-500">{child.type}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-500">
                    {child.totalSize}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {renderOwnerBadge("You")}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {child.type === "file" && (
                    <button
                      className="text-white bg-gray-500 hover:bg-gray-600 px-3 py-1 rounded mr-2"
                      onClick={() => downloadFile(child.cid)}
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
      <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
        <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
          <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
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
              <tbody className="bg-white divide-y divide-gray-200">
                {files.map((file) => renderRow(file))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
