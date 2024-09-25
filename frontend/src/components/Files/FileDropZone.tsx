import React, { useState, useRef, useCallback } from "react";
import { constructFromFileSystemEntries } from "../../models/FileTree";
import {
  Menu,
  MenuButton,
  MenuSection,
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from "@headlessui/react";
import { FileIcon, FolderIcon } from "lucide-react";
import { ApiService } from "../../services/api";
import { useLocalStorage } from "usehooks-ts";

export function FileDropZone() {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [localObjectCIDs, setLocalObjectCIDs] = useLocalStorage<string[]>(
    "root-objects-cid-v3",
    []
  );

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry()!)
      .filter((item) => item !== null);

    const recursiveEntries = await Promise.all(
      items.map((item) => getRecursiveEntry(item))
    ).then((entries) =>
      entries
        .flat()
        .map(({ entry, file }) => ({ file, path: entry.fullPath.slice(1) }))
    );

    const [tree, files] = constructFromFileSystemEntries(recursiveEntries);

    const { cid } = await ApiService.uploadFolder(tree, files);

    // add to local object cids discarding duplicates
    setLocalObjectCIDs((prev) => [...prev.filter((i) => i !== cid), cid]);

    window.location.reload();
  }, []);

  const getRecursiveEntry = useCallback(
    async (
      entry: FileSystemEntry
    ): Promise<{ entry: FileSystemEntry; file: File }[]> => {
      if (entry.isFile) {
        return [
          { entry, file: await readEntryAsFile(entry as FileSystemFileEntry) },
        ];
      } else if (entry.isDirectory) {
        const directoryReader = (
          entry as FileSystemDirectoryEntry
        ).createReader();

        const subentries = await readEntriesPromise(directoryReader);

        return Promise.all(
          subentries.map((subentry) => getRecursiveEntry(subentry))
        ).then((entries) => [...entries.flat()]);
      } else {
        console.log("entry is not a file or directory", entry);
        return [];
      }
    },
    []
  );

  const readEntriesPromise = useCallback(
    (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => {
      return new Promise((resolve) => {
        reader.readEntries((entries) => resolve(entries));
      });
    },
    []
  );

  const readEntryAsFile = useCallback((entry: FileSystemFileEntry) => {
    return new Promise<File>((resolve) => {
      entry.file((file) => resolve(file));
    });
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const file = e.target.files[0];
        const { cid } = await ApiService.uploadFile(file);

        // add to local object cids discarding duplicates
        setLocalObjectCIDs((prev) => [...prev.filter((i) => i !== cid), cid]);

        window.location.reload();
      }
    },
    []
  );

  const handleFolderInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        if (!e.target.files) return;

        const [tree, files] = constructFromFileSystemEntries(
          Array.from(e.target.files).map((file) => ({
            file,
            path: file.webkitRelativePath,
          }))
        );

        const { cid } = await ApiService.uploadFolder(tree, files).catch(() => {
          alert("Error uploading folder");
          throw new Error("Error uploading folder");
        });

        // add to local object cids discarding duplicates
        setLocalObjectCIDs((prev) => [...prev.filter((i) => i !== cid), cid]);

        window.location.reload();
      }
    },
    []
  );

  const openFolderDialog = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="max-w-full flex flex-col gap-4">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        className="hidden"
        multiple
      />
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderInputChange}
        className="hidden"
        webkitdirectory="true"
      />
      <Popover as="div" className="relative">
        <PopoverButton as="div">
          <div
            className={`w-full h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center transition-colors cursor-pointer ${
              isDragging ? "border-green-500 bg-green-50" : "border-green-300"
            }`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <p className="text-green-600 text-center mb-2">
              Add or drop files / folders here
            </p>
          </div>
        </PopoverButton>
        <Transition
          enter="transition duration-100 ease-out"
          enterFrom="transform scale-95 opacity-0"
          enterTo="transform scale-100 opacity-100"
          leave="transition duration-75 ease-out"
          leaveFrom="transform scale-100 opacity-100"
          leaveTo="transform scale-95 opacity-0"
        >
          <PopoverPanel className="absolute z-10 w-full mt-2">
            <div className="bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5">
              <div className="p-4">
                <button
                  onClick={openFileDialog}
                  className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  <FileIcon className="w-5 h-5 mr-3 text-gray-400" />
                  Select Files
                </button>
                <button
                  onClick={openFolderDialog}
                  className="flex items-center w-full px-4 py-2 mt-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  <FolderIcon className="w-5 h-5 mr-3 text-gray-400" />
                  Select Folder
                </button>
              </div>
            </div>
          </PopoverPanel>
        </Transition>
      </Popover>
    </div>
  );
}
