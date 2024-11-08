'use client';

import { Transition } from '@headlessui/react';
import { SearchIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { handleEnterOrSpace } from '../../utils/eventHandler';

export const HandleSelector = ({
  selectedHandle,
  setSelectedHandle,
}: {
  selectedHandle: string | null;
  setSelectedHandle: (publicId: string | null) => void;
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [recommendations, setRecommendations] = useState<string[] | null>(null);

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

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedHandle(null);
    setQuery(event.target.value);
    setIsOpen(true);
  };

  const handleSelectItem = useCallback(
    (item: string) => {
      setIsOpen(false);
      dropdownRef.current?.blur();
      setRecommendations(null);
      setSelectedHandle(item);
      inputRef.current?.focus();
    },
    [setSelectedHandle, setRecommendations, setIsOpen, dropdownRef, inputRef],
  );

  const searchBarResult = useMemo(() => {
    if (query.length === 0 || !recommendations) {
      return <></>;
    }

    if (recommendations && recommendations.length === 0) {
      return (
        <li className='relative cursor-default select-none px-4 py-2 text-gray-700'>
          Nothing found.
        </li>
      );
    }

    return recommendations.map((item) => (
      <div
        key={item}
        role='button'
        tabIndex={0}
        onKeyDown={handleEnterOrSpace(() => handleSelectItem(item))}
        className='relative cursor-pointer select-none overflow-hidden text-ellipsis px-4 py-2 font-semibold text-gray-900 hover:bg-blue-600 hover:text-white'
        onClick={() => handleSelectItem(item)}
      >
        {item}
      </div>
    ));
  }, [handleSelectItem, query.length, recommendations]);

  const isRecommendationsOpen = useMemo(() => {
    return isOpen && recommendations && recommendations.length > 0;
  }, [isOpen, recommendations]);

  return (
    <div className='mx-auto w-full max-w-md'>
      <div className='relative mt-1'>
        <div className='relative w-full'>
          <input
            ref={inputRef}
            type='text'
            className='w-full rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm leading-5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
            value={selectedHandle ?? query}
            onChange={handleInputChange}
            onFocus={() => setIsOpen(true)}
            placeholder='Public ID'
          />
          <button
            type='button'
            className='absolute inset-y-0 right-0 flex items-center pr-2'
            onClick={() => inputRef.current?.focus()}
          >
            <SearchIcon className='h-5 w-5 text-gray-400' aria-hidden='true' />
          </button>
        </div>
        <Transition
          show={!!isRecommendationsOpen}
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
      </div>
    </div>
  );
};
