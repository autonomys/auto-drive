import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react';
import { useFileTableState } from '@/components/organisms/FileTable/state';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TABLE_ROW_LIMITS } from '@/constants/table';
import {
  getDisplayPageNumber,
  getTotalPages,
  updateUrlParams,
} from '@/utils/table';

export const TablePaginator = () => {
  const {
    limit,
    setLimit,
    page,
    setPage: setInternalPage,
    total,
    isInitialized,
    initFromUrl,
    aggregateLimit,
  } = useFileTableState();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [pageInput, setPageInput] = useState<string>(
    getDisplayPageNumber(page),
  );

  const isLimitUnknown = aggregateLimit === total;

  const offset = page * limit;
  const effectiveTotal = isLimitUnknown ? aggregateLimit + offset : total;

  const totalPages = getTotalPages(effectiveTotal, limit);

  // Initialize from URL params on mount
  useEffect(() => {
    initFromUrl();
  }, [initFromUrl]);

  useEffect(() => {
    setPageInput(getDisplayPageNumber(page));
  }, [page]);

  // Update URL when state changes
  useEffect(() => {
    // Skip until initialization is complete
    if (!isInitialized) return;
    updateUrlParams(pathname, searchParams, page, limit, router);
  }, [page, limit, pathname, router, searchParams, isInitialized]);

  const goToPage = () => {
    const newPage = parseInt(pageInput);
    if (!isNaN(newPage) && newPage >= 1 && newPage <= totalPages) {
      setInternalPage(newPage - 1);
    } else {
      setPageInput(getDisplayPageNumber(page));
    }
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      goToPage();
    }
  };

  return (
    <div className='flex w-full items-center justify-between bg-background p-4 text-sm text-foreground'>
      <div className='flex items-center'>
        <span className='mr-2'>Items per page:</span>
        <select
          className='bg-background-hover text-foreground-hover rounded border border-gray-300 p-1 pr-1 hover:bg-background hover:text-foreground'
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
          {effectiveTotal > 0
            ? `${page * limit + 1}-${Math.min(page * limit + limit, effectiveTotal)} of ${isLimitUnknown ? `${effectiveTotal}+` : effectiveTotal} items`
            : '0 items'}
        </span>
      </div>
      <div className='flex items-center gap-2'>
        <button
          disabled={page === 0}
          className='border-light-gray cursor-pointer rounded-md border p-2 transition-all hover:scale-[102%] disabled:scale-100 disabled:opacity-50'
          onClick={() => setInternalPage(0)}
          title='First page'
        >
          <ChevronsLeftIcon className='h-4 w-4' />
        </button>
        <button
          disabled={page === 0}
          className='border-light-gray cursor-pointer rounded-md border p-2 transition-all hover:scale-[102%] disabled:scale-100 disabled:opacity-50'
          onClick={() => setInternalPage(page - 1)}
          title='Previous page'
        >
          <ChevronLeftIcon className='h-4 w-4' />
        </button>
        <div className='flex items-center gap-1'>
          <input
            type='text'
            value={pageInput}
            onChange={handlePageInputChange}
            onBlur={goToPage}
            onKeyDown={handleKeyDown}
            className='bg-background-hover text-foreground-hover w-12 rounded border border-gray-300 p-1.5 text-center hover:bg-background hover:text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
            aria-label='Page number'
          />
          <span>of {isLimitUnknown ? `${totalPages}+` : totalPages}</span>
        </div>
        <button
          disabled={page >= totalPages - 1}
          className='border-light-gray cursor-pointer rounded-md border p-2 transition-all hover:scale-[102%] disabled:scale-100 disabled:opacity-50'
          onClick={() => setInternalPage(page + 1)}
          title='Next page'
        >
          <ChevronRightIcon className='h-4 w-4' />
        </button>
        <button
          disabled={page >= totalPages - 1}
          className='border-light-gray cursor-pointer rounded-md border p-2 transition-all hover:scale-[102%] disabled:scale-100 disabled:opacity-50'
          onClick={() => setInternalPage(totalPages - 1)}
          title='Last page'
        >
          <ChevronsRightIcon className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
};
