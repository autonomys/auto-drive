/* eslint-disable camelcase */
import { Triangle } from 'lucide-react';
import { Metadata_Roots_Order_By, Order_By } from '../../../../../gql/graphql';
import { TableHeadCell } from '../../../common/Table/TableHead';
import { useFileTableState } from '../../state';
import { useCallback } from 'react';

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

  const isActive = sortedBy[sortingKey];
  const isAsc = isActive && isActive === Order_By.AscNullsLast;
  const isDesc = isActive && isActive === Order_By.DescNullsLast;

  const triangle = isAsc ? (
    <Triangle className='h-3 w-3' fill='currentColor' />
  ) : isDesc ? (
    <Triangle className='h-3 w-3 rotate-180' fill='currentColor' />
  ) : null;

  const toggleSort = useCallback(() => {
    setSortBy({
      [sortingKey]: isDesc ? Order_By.AscNullsLast : Order_By.DescNullsLast,
    });
  }, [sortingKey, setSortBy, isDesc]);

  return (
    <TableHeadCell
      onClick={toggleSort}
      className='flex cursor-pointer items-center gap-1'
    >
      {triangle} {name}
    </TableHeadCell>
  );
};
