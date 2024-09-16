'use client'

import React, { useCallback, useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Folder, File, MoreVertical, Download, Trash, Edit, Share2 } from 'lucide-react'
import { ApiService } from '../../services/api'

interface FileCardProps {
    type: 'folder' | 'file'
    name: string
    cid: string
    size?: number
    modified?: string
    icon?: React.ReactNode
}

export default function FileCard({ type, name, size, modified, icon, cid }: FileCardProps) {
    const [isHovered, setIsHovered] = useState(false)

    const getFileIcon = () => {
        if (icon) return icon
        return type === 'folder' ? <Folder className="w-8 h-8 text-blue-500" /> : <File className="w-8 h-8 text-gray-500" />
    }

    const onDownload = useCallback((event: React.MouseEvent<HTMLButtonElement>, cid: string) => {
        console.log(cid);
        event.preventDefault()
        event.stopPropagation()
        const url = ApiService.fetchDataURL(cid)
        window.open(url, '_blank')
    }, [])

    return (
        <div
            className="flex-1 max-w-72 h-72 m-2 p-4 bg-white rounded-lg shadow-sm cursor-pointer transition-all duration-200 hover:shadow-md flex flex-col justify-between"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="flex justify-between items-start">
                {getFileIcon()}
                <Menu as="div" className="relative inline-block text-left">
                    <MenuButton className="inline-flex items-center justify-center w-8 h-8 p-0 text-sm font-medium text-gray-700 bg-white rounded-md hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
                        <MoreVertical className="h-4 w-4" />
                    </MenuButton>
                    <MenuItems className="absolute right-0 w-56 mt-2 origin-top-right bg-white divide-y divide-gray-100 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                        <div className="px-1 py-1">
                            <MenuItem>
                                {({ focus }) => (
                                    <button
                                        className={`${focus ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
                                            } group flex rounded-md items-center w-full px-2 py-2 text-sm`}
                                    >
                                        <Edit className="w-5 h-5 mr-2" aria-hidden="true" />
                                        Rename
                                    </button>
                                )}
                            </MenuItem>
                            <MenuItem>
                                {({ focus }) => (
                                    <button
                                        className={`${focus ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
                                            } group flex rounded-md items-center w-full px-2 py-2 text-sm`}
                                    >
                                        <Share2 className="w-5 h-5 mr-2" aria-hidden="true" />
                                        Share
                                    </button>
                                )}
                            </MenuItem>
                            {type === 'file' && (
                                <MenuItem>
                                    {({ focus }) => (
                                        <button
                                            onClick={(event) => onDownload(event, cid)}
                                            className={`${focus ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
                                                } group flex rounded-md items-center w-full px-2 py-2 text-sm`}
                                        >
                                            <Download className="w-5 h-5 mr-2" aria-hidden="true" />
                                            Download
                                        </button>
                                    )}
                                </MenuItem>
                            )}
                            <MenuItem>
                                {({ focus }) => (
                                    <button
                                        className={`${focus ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
                                            } group flex rounded-md items-center w-full px-2 py-2 text-sm text-red-600`}
                                    >
                                        <Trash className="w-5 h-5 mr-2" aria-hidden="true" />
                                        Delete
                                    </button>
                                )}
                            </MenuItem>
                        </div>
                    </MenuItems>
                </Menu>
            </div>
            <div className="mt-4">
                <h3 className="font-semibold text-lg truncate">{name}</h3>
                {size && <p className="text-sm text-gray-500 mt-1">Size: {size}</p>}
                {modified && <p className="text-sm text-gray-500 mt-1">Modified: {modified}</p>}
            </div>
            {isHovered && type === 'file' && (
                <button onClick={(event) => onDownload(event, cid)} className="mt-4 w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors duration-200 flex items-center justify-center">
                    <Download className="mr-2 h-4 w-4" />
                    Download
                </button>
            )}
        </div>
    )
}