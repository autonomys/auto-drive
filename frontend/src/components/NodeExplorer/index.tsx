'use client';

import type { IPLDNodeData } from '@autonomys/auto-dag-data';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { FC, useState } from 'react';
import { InternalLink } from '../common/InternalLink';
import { useNetwork } from '../../contexts/network';
import { ROUTES } from '../../constants/routes';

interface NodeExplorerProps {
  cid: string;
  links: string[];
  metadata: IPLDNodeData;
}

export const NodeExplorer: FC<NodeExplorerProps> = ({
  cid,
  links,
  metadata,
}) => {
  const [isMetadataOpen, setIsMetadataOpen] = useState(true);
  const [isLinksOpen, setIsLinksOpen] = useState(true);
  const { network } = useNetwork();

  const toggleMetadata = () => setIsMetadataOpen(!isMetadataOpen);
  const toggleLinks = () => setIsLinksOpen(!isLinksOpen);

  const hasMetadata = metadata && Object.keys(metadata).length > 0;

  return (
    <div className='mx-auto max-w-4xl rounded-lg bg-white p-6 shadow-lg'>
      <h1 className='mb-6 text-3xl font-bold text-gray-800'>
        Node {cid.slice(0, 10)}
      </h1>

      {hasMetadata && (
        <div className='mb-6'>
          <button
            onClick={toggleMetadata}
            className='flex items-center text-xl font-semibold text-gray-700 hover:text-gray-900'
          >
            {isMetadataOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
            Metadata
          </button>
          {isMetadataOpen && (
            <div className='mt-4 rounded-md bg-gray-50 p-4'>
              {metadata &&
                Object.entries(metadata).map(([key, value]) => (
                  <div key={key} className='mb-2 grid grid-cols-2 gap-4'>
                    <span className='font-medium text-gray-600'>{key}</span>
                    <span className='text-ellipsis text-wrap text-gray-800'>
                      {value.toString()}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <div>
        <button
          onClick={toggleLinks}
          className='flex items-center text-xl font-semibold text-gray-700 hover:text-gray-900'
        >
          {isLinksOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
          Links
        </button>
        {isLinksOpen && (
          <ul className='mt-4 space-y-2'>
            {links.map((link, index) => (
              <li key={index}>
                <InternalLink
                  href={ROUTES.fs(network.id, link)}
                  className='break-all text-blue-600 hover:text-blue-800 hover:underline'
                >
                  {link}
                </InternalLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
