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
        'w-full bg-white hover:bg-gray-50 dark:bg-darkWhite dark:hover:bg-darkWhiteHover border-t border-gray-200',
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
    <td
      className={cn(
        'px-6 py-4 text-sm text-primary dark:text-darkBlack',
        className,
      )}
      colSpan={colSpan}
    >
      {children}
    </td>
  );
};
