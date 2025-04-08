import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useFileTableState } from '@/components/FileTables/state';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { TABLE_ROW_LIMITS } from '@/constants/table';
import { updateUrlParams } from '@/utils/table';

export const TablePaginator = () => {
  const {
    limit,
    setLimit,
    page,
    setPage: setInternalPage,
    total,
    isInitialized,
    initFromUrl,
  } = useFileTableState();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize from URL params on mount
  useEffect(() => {
    initFromUrl();
  }, [initFromUrl]);

  // Update URL when state changes
  useEffect(() => {
    // Skip until initialization is complete
    if (!isInitialized) return;
    updateUrlParams(pathname, searchParams, page, limit, router);
  }, [page, limit, pathname, router, searchParams, isInitialized]);

  return (
    <div className='flex w-full items-center justify-between p-4 text-sm text-light-gray dark:text-darkBlack'>
      <div className='flex items-center'>
        <span className='mr-2'>Items per page:</span>
        <select
          className='rounded border border-gray-300 bg-gray-100 p-1 pr-1 dark:bg-darkWhite'
          value={limit}
          onChange={(e) => setLimit(parseInt(e.target.value))}
        >
          {TABLE_ROW_LIMITS.map((limit) => (
            <option key={limit} value={limit}>
              {limit}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span>
          {page * limit + 1}-{Math.min(page * limit + limit, total)} of {total}{' '}
          items
        </span>
      </div>
      <div className='flex items-center gap-2'>
        <button
          disabled={page === 0}
          className='cursor-pointer rounded-md border border-light-gray p-2 text-black transition-all hover:scale-[102%] disabled:opacity-0 dark:text-darkBlack'
          onClick={() => setInternalPage(page - 1)}
        >
          <ChevronLeftIcon className='h-4 w-4' />
        </button>
        <button
          disabled={page * limit + limit >= total}
          className='cursor-pointer rounded-md border border-light-gray p-2 text-black transition-all hover:scale-[102%] disabled:opacity-0 dark:text-darkBlack'
          onClick={() => setInternalPage(page + 1)}
        >
          <ChevronRightIcon className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
};
