import { ReactNode } from 'react';
import { cn } from '@/utils/cn';
export const TableHead = ({ children }: { children: ReactNode }) => {
  return (
    <thead className='rounded-lg bg-background font-semibold text-foreground'>
      {children}
    </thead>
  );
};

export const TableHeadRow = ({ children }: { children: ReactNode }) => {
  return <tr className='rounded-lg'>{children}</tr>;
};

export const TableHeadCell = ({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) => {
  return (
    <th
      scope='col'
      className={cn(
        'rounded-lg px-6 py-3 text-left text-xs uppercase tracking-wider',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </th>
  );
};
