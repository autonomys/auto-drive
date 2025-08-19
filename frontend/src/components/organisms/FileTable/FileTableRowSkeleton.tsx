import { TableBodyCell, TableBodyRow } from '../../molecules/Table/TableBody';

export const FileTableRowSkeleton = () => {
  return (
    <TableBodyRow>
      <TableBodyCell className='whitespace-nowrap text-sm'>
        <div className='flex items-center'>
          <div className='mr-3 h-4 w-4 animate-pulse rounded bg-gray-200'></div>
          <div className='ml-2 flex flex-row items-center'>
            <div className='mr-2 h-5 w-5 animate-pulse rounded bg-gray-200'></div>
            <div className='h-4 w-32 animate-pulse rounded bg-gray-200'></div>
          </div>
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='h-4 w-24 animate-pulse rounded bg-gray-200'></div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='h-6 w-16 animate-pulse rounded-full bg-gray-200'></div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='h-4 w-16 animate-pulse rounded bg-gray-200'></div>
      </TableBodyCell>
      <TableBodyCell>
        <div className='h-4 w-20 animate-pulse rounded bg-gray-200'></div>
      </TableBodyCell>
      <TableBodyCell className='flex justify-end'>
        <div className='h-8 w-8 animate-pulse rounded bg-gray-200'></div>
      </TableBodyCell>
    </TableBodyRow>
  );
};
