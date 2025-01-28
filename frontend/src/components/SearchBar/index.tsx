'use client';

import { Transition } from '@headlessui/react';
import { SearchIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ObjectSearchResult } from '../../models/ObjectSearchResult';
import { handleEnterOrSpace } from '../../utils/eventHandler';
import { useQuery } from '@apollo/client';
import {
  SEARCH_GLOBAL_METADATA_BY_CID_OR_NAME,
  SEARCH_USER_METADATA_BY_CID_OR_NAME,
} from '../../services/gql/common/query';
import { useSession } from 'next-auth/react';
import {
  SearchGlobalMetadataByCidOrNameQuery,
  SearchUserMetadataByCidOrNameQuery,
} from '../../../gql/graphql';
import { ROUTES } from '../../constants/routes';
import { useNetwork } from '../../contexts/network';

export const SearchBar = ({ scope }: { scope: 'global' | 'user' }) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const session = useSession();
  const [recommendations, setRecommendations] = useState<
    ObjectSearchResult[] | null
  >(null);
  const router = useRouter();
  const { network } = useNetwork();

  const gqlQuery =
    scope === 'global'
      ? SEARCH_GLOBAL_METADATA_BY_CID_OR_NAME
      : SEARCH_USER_METADATA_BY_CID_OR_NAME;

  useQuery(gqlQuery, {
    variables: {
      search: `%${query}%`,
      limit: 5,
      oauthUserId: session.data?.underlyingUserId,
      oauthProvider: session.data?.underlyingProvider,
    },
    skip: query.length < 3,
    onCompleted: (
      data: SearchGlobalMetadataByCidOrNameQuery &
        SearchUserMetadataByCidOrNameQuery,
    ) => {
      console.log('data', data);

      setRecommendations(
        data.metadata.map((e) => ({
          cid: e.cid,
          name: e.name ?? '',
        })),
      );
    },
    onError: (error) => {
      setError(error.message);
    },
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value);
      setIsOpen(true);
    },
    [],
  );

  const handleSelectItem = useCallback(
    (cid: string) => {
      setIsOpen(false);
      router.push(ROUTES.search(network.id, cid));
      inputRef.current?.focus();
    },
    [network, router],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        event.key === 'Enter' &&
        recommendations &&
        recommendations.length > 0
      ) {
        router.push(ROUTES.search(network.id, query));
      }
    },
    [recommendations, query, router, network],
  );

  const searchBarResult = useMemo(() => {
    if (query.length === 0 || !recommendations) {
      return <></>;
    }

    if (error) {
      return (
        <li className='relative cursor-default select-none px-4 py-2 text-red-500'>
          {error}
        </li>
      );
    }

    if (recommendations && recommendations.length === 0) {
      return (
        <li className='relative cursor-default select-none px-4 py-2 text-gray-700'>
          Nothing found.
        </li>
      );
    }

    return recommendations.map((item) => {
      const displayText = item.name.toLowerCase().includes(query.toLowerCase())
        ? item.name
        : item.cid;

      return (
        <div
          role='button'
          tabIndex={0}
          key={item.cid}
          onKeyDown={handleEnterOrSpace(() => handleSelectItem(item.cid))}
          className='relative cursor-pointer select-none overflow-hidden text-ellipsis px-4 py-2 font-semibold text-gray-900 hover:bg-blue-600 hover:text-white'
          onClick={() => handleSelectItem(item.cid)}
        >
          {displayText}
        </div>
      );
    });
  }, [query, recommendations, error, handleSelectItem]);

  return (
    <div className='mx-auto w-full max-w-md'>
      <div className='relative mt-1'>
        <div className='relative w-full'>
          <input
            ref={inputRef}
            type='text'
            className='w-full rounded-lg border border-[#BCC1CA] bg-white py-2 pl-3 pr-10 text-sm leading-5 text-black text-gray-900 placeholder:text-black focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
            value={query}
            onChange={handleInputChange}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder='Search by Name or CID'
          />
          <button
            type='button'
            className='absolute inset-y-0 right-0 flex items-center pr-2'
            onClick={() => inputRef.current?.focus()}
          >
            <SearchIcon className='h-5 w-5 text-gray-400' aria-hidden='true' />
          </button>
        </div>
        {
          <Transition
            show={isOpen}
            enter='transition ease-out duration-100'
            enterFrom='transform opacity-0 scale-95'
            enterTo='transform opacity-100 scale-100'
            leave='transition ease-in duration-75'
            leaveFrom='transform opacity-100 scale-100'
            leaveTo='transform opacity-0 scale-95'
          >
            <ul
              ref={dropdownRef}
              className='absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm'
            >
              {searchBarResult}
            </ul>
          </Transition>
        }
      </div>
    </div>
  );
};
