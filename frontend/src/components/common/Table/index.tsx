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
    <div className='w-full border-separate rounded-lg border'>
      <table className={cn('w-full', className)}>{children}</table>
    </div>
  );
};
