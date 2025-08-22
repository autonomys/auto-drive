/* eslint-disable camelcase */
import { Metadata_Roots_Order_By, Order_By } from '../../../../gql/graphql';
import { TableHeadCell } from '../../molecules/Table/TableHead';
import { useFileTableState } from './state';
import { useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { updateSortParams } from '@/utils/table';
import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

interface SortableTableColumnProps {
  name: string;
  sortingKey: keyof Metadata_Roots_Order_By;
}

export const SortableTableColumn = ({
  name,
  sortingKey,
}: SortableTableColumnProps) => {
  const sortedBy = useFileTableState((v) => v.sortBy);
  const setSortBy = useFileTableState((v) => v.setSortBy);
  const isInitialized = useFileTableState((v) => v.isInitialized);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isActive = sortedBy[sortingKey];
  const isAsc = isActive && isActive === Order_By.AscNullsLast;
  const isDesc = isActive && isActive === Order_By.DescNullsLast;

  const triangle = isAsc ? (
    <ChevronUpIcon className='h-4 w-4' fill='currentColor' />
  ) : isDesc ? (
    <ChevronDownIcon className='h-4 w-4' fill='currentColor' />
  ) : (
    <div className='flex h-6 flex-col'>
      <ChevronUpIcon className='h-4 w-4' fill='currentColor' />
      <ChevronDownIcon className='h-4 w-4' fill='currentColor' />
    </div>
  );

  const toggleSort = useCallback(() => {
    // Only update if initialization is complete
    if (!isInitialized) return;
    const newSortOrder = isDesc
      ? Order_By.AscNullsLast
      : Order_By.DescNullsLast;
    // Update the sort state
    setSortBy({
      [sortingKey]: newSortOrder,
    });
    // Update URL with sort parameters
    updateSortParams(pathname, searchParams, sortingKey, newSortOrder, router);
  }, [
    sortingKey,
    setSortBy,
    isDesc,
    router,
    pathname,
    searchParams,
    isInitialized,
  ]);

  return (
    <TableHeadCell
      onClick={toggleSort}
      className='flex cursor-pointer items-center gap-1'
    >
      {triangle} {name}
    </TableHeadCell>
  );
};
