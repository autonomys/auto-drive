'use client';

import { SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFileTableState } from '../FileTables/state';
import { useDebounce } from '@/hooks/useDebounce';

export const SearchBar = ({ scope }: { scope: 'global' | 'user' }) => {
  const setSearchQuery = useFileTableState((e) => e.setSearchQuery);
  const searchQuery = useFileTableState((e) => e.searchQuery);
  const [inputValue, setInputValue] = useState(searchQuery);
  const debouncedValue = useDebounce(inputValue, 300); // 300ms delay

  useEffect(() => {
    setSearchQuery(debouncedValue);
  }, [debouncedValue, setSearchQuery]);

  const placeholder = useMemo(() => {
    if (scope === 'global') {
      return 'Search by Name or CID';
    }
    return 'Search by Name or CID within your files';
  }, [scope]);

  return (
    <div className='mx-auto w-full max-w-md dark:text-darkBlack'>
      <div className='relative mt-1'>
        <div className='relative w-full'>
          <input
            type='text'
            className='w-full rounded-lg border border-[#BCC1CA] bg-white py-2 pl-3 pr-10 text-sm leading-5 text-gray-900 placeholder:text-black focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-darkWhite dark:text-darkBlack dark:placeholder:text-darkBlack'
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
            }}
            placeholder={placeholder}
          />
          <button
            type='button'
            className='absolute inset-y-0 right-0 flex items-center pr-2'
          >
            <SearchIcon className='h-5 w-5 text-gray-400' aria-hidden='true' />
          </button>
        </div>
      </div>
    </div>
  );
};
