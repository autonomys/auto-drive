import { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export const TableFooter = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return <tfoot className={cn('border-t border-gray-200', className)}>{children}</tfoot>;
};
