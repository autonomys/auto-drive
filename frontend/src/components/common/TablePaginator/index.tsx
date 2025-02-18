import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useFileTableState } from '../../../views/FileTables/state';

export const TablePaginator = () => {
  const {
    limit,
    setLimit,
    page,
    setPage: setCurrentPage,
    total,
  } = useFileTableState();
  return (
    <div className='flex w-full items-center justify-between p-4 text-sm text-light-gray dark:text-darkBlack'>
      <div className='flex items-center'>
        <span className='mr-2'>Items per page:</span>
        <select
          className='rounded border border-gray-300 bg-gray-100 p-1 pr-1 dark:bg-darkWhite'
          value={limit}
          onChange={(e) => setLimit(parseInt(e.target.value))}
        >
          <option value='5'>5</option>
          <option value='10'>10</option>
          <option value='20'>20</option>
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
          onClick={() => setCurrentPage(page - 1)}
        >
          <ChevronLeftIcon className='h-4 w-4' />
        </button>
        <button
          disabled={page * limit + limit >= total}
          className='cursor-pointer rounded-md border border-light-gray p-2 text-black transition-all hover:scale-[102%] disabled:opacity-0 dark:text-darkBlack'
          onClick={() => setCurrentPage(page + 1)}
        >
          <ChevronRightIcon className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
};
