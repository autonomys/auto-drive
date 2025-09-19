import { cn } from '@auto-drive/ui';

export const InfoRow = ({
  label,
  value,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  className?: string;
}) => {
  return (
    <div className={cn('flex justify-between gap-2', className)}>
      <span className='text-sm font-medium'>{label}</span>
      <span className={accent ? 'font-semibold text-primary' : ''}>
        {value}
      </span>
    </div>
  );
};
