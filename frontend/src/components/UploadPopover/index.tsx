'use client'

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react"
import { PlusIcon, FolderIcon, FileIcon } from "lucide-react"
import { buttonVariantClasses } from "../common/Button"
import { useCallback, useRef } from "react"
import { ApiService } from "../../services/api"
import { useLocalStorage } from "@uidotdev/usehooks"

declare module 'react' {
    interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
        webkitdirectory?: string;
        directory?: string;
    }
}

export const UploadPopover = () => {
    const [localObjectCIDs, setLocalObjectCIDs] = useLocalStorage<string[]>("root-objects-cid", []);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) {
            return
        }

        const { result } = await ApiService.uploadFile(file)

        setLocalObjectCIDs([...localObjectCIDs, result.cid])

        alert("File uploaded")
    }, [localObjectCIDs, setLocalObjectCIDs]);

    const handleFolderUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files
        if (!files) {
            return
        }

        const { result } = await ApiService.uploadFolder(files)

        setLocalObjectCIDs([...localObjectCIDs, result.cid])

        alert("Folder uploaded")
    }, [localObjectCIDs, setLocalObjectCIDs]);

    return <Popover className="contents flex">
        <PopoverButton className={`${buttonVariantClasses.primary} flex items-center space-x-2 w-full px-2`}>
            <PlusIcon className="h-4 w-4" />
            <span>New</span>
        </PopoverButton>
        <input type="file" className="hidden" onChange={handleFileUpload} ref={fileInputRef} />
        <input type="file" className="hidden" onChange={handleFolderUpload} webkitdirectory="true" directory="true" ref={folderInputRef} />
        <PopoverPanel
            transition
            anchor='bottom'
            className="w-fit-content mt-2 divide-y divide-gray-200 rounded-xl bg-white text-sm/6 transition duration-200 ring-1 ring-gray-200 ease-in-out [--anchor-gap:var(--spacing-5)] data-[closed]:-translate-y-1 data-[closed]:opacity-0"
        >
            <div className="p-3">
                <a className="block rounded-lg py-2 px-3 transition hover:bg-gray-100" onClick={() => folderInputRef.current?.click()}>
                    <span className="flex items-center gap-2 font-semibold text-gray-800">
                        <FolderIcon size={16} /> Upload folder
                    </span>
                </a>
                <a className="block rounded-lg py-2 px-3 transition hover:bg-gray-100" onClick={() => fileInputRef.current?.click()}>
                    <span className="flex items-center gap-2 font-semibold text-gray-800">
                        <FileIcon size={16} /> Upload file
                    </span>
                </a>
            </div>
        </PopoverPanel>
    </Popover>
}