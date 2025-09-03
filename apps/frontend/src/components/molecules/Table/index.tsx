import { ReactNode } from 'react';
import { cn } from '../../../utils/cn';

export const Table = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div className='w-full rounded-lg border border-gray-200 overflow-hidden'>
      <table className={cn('w-full border-collapse', className)}>{children}</table>
    </div>
  );
};
