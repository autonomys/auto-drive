import { ReactNode } from 'react';

export const Table = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div
      className='border-separate rounded-lg border'
      style={{ borderSpacing: '0px' }}
    >
      <table
        className={`min-w-full border-collapse rounded-lg ${className ?? ''}`}
      >
        {children}
      </table>
    </div>
  );
};
