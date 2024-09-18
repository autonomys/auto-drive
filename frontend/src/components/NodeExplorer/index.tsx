'use client'

import type { IPLDNodeData } from "@autonomys/auto-drive"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { FC, useState } from "react"

interface NodeExplorerProps {
    cid: string
    links: string[]
    metadata: IPLDNodeData
}

export const NodeExplorer: FC<NodeExplorerProps> = ({ cid, links, metadata }) => {
    const [isMetadataOpen, setIsMetadataOpen] = useState(true)
    const [isLinksOpen, setIsLinksOpen] = useState(true)

    const toggleMetadata = () => setIsMetadataOpen(!isMetadataOpen)
    const toggleLinks = () => setIsLinksOpen(!isLinksOpen)

    const hasMetadata = metadata && Object.keys(metadata).length > 0;

    return <div className="max-w-4xl mx-auto p-6 bg-white shadow-lg rounded-lg">
        <h1 className="text-3xl font-bold mb-6 text-gray-800">Node {cid.slice(0, 10)}</h1>

        {hasMetadata && (
            <div className="mb-6">
                <button
                    onClick={toggleMetadata}
                    className="flex items-center text-xl font-semibold text-gray-700 hover:text-gray-900"
                >
                    {isMetadataOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    Metadata
                </button>
                {isMetadataOpen && (
                    <div className="mt-4 bg-gray-50 p-4 rounded-md">
                        {metadata && Object.entries(metadata).map(([key, value]) => (
                            <div key={key} className="grid grid-cols-2 gap-4 mb-2">
                                <span className="font-medium text-gray-600">{key}</span>
                                <span className="text-gray-800 text-wrap text-ellipsis">{value.toString()}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}

        <div>
            <button
                onClick={toggleLinks}
                className="flex items-center text-xl font-semibold text-gray-700 hover:text-gray-900"
            >
                {isLinksOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                Links
            </button>
            {isLinksOpen && (
                <ul className="mt-4 space-y-2">
                    {links.map((link, index) => (
                        <li key={index}>
                            <a
                                href={`/explorer/${link}`}
                                className="text-blue-600 hover:text-blue-800 hover:underline break-all"
                            >
                                {link}
                            </a>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    </div>
}