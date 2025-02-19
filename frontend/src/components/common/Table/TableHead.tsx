import { ReactNode } from 'react';

export const TableHead = ({ children }: { children: ReactNode }) => {
  return (
    <thead className='rounded-lg bg-white font-semibold text-primary dark:bg-darkWhite'>
      {children}
    </thead>
  );
};

export const TableHeadRow = ({ children }: { children: ReactNode }) => {
  return <tr className='rounded-lg border-b border-gray-200'>{children}</tr>;
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
      className={`rounded-lg px-6 py-3 text-left text-xs uppercase tracking-wider dark:text-darkBlack ${
        className ?? ''
      }`}
      onClick={onClick}
    >
      {children}
    </th>
  );
};
