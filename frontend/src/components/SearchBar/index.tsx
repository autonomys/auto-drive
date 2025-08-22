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
    <div className='w-full max-w-md text-foreground'>
      <div className='relative mt-1'>
        <div className='relative h-fit min-w-80'>
          <input
            type='text'
            className='w-full rounded-lg border border-[#BCC1CA] bg-background py-[.65rem] pl-3 pr-10 text-sm leading-5 text-foreground text-gray-900 placeholder:text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-background text-foreground placeholder:text-foreground'
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
