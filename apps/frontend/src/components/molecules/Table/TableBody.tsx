import { cn } from '@/utils/cn';
import { ReactNode } from 'react';

export const TableBody = ({ children }: { children: ReactNode }) => {
  return <tbody className='w-full'>{children}</tbody>;
};

export const TableBodyRow = ({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  className?: string;
}) => {
  return (
    <tr
      className={cn(
        'hover:bg-background-hover w-full border-t border-gray-200 bg-background',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
};

export const TableBodyCell = ({
  children,
  className,
  colSpan,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}) => {
  return (
    <td className={cn('px-6 py-4 text-sm', className)} colSpan={colSpan}>
      {children}
    </td>
  );
};
