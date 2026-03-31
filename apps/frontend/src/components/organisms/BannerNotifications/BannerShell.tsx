'use client';

import { BannerCriticality } from '@auto-drive/models';
import { X, AlertTriangle, AlertCircle, Info } from 'lucide-react';

const criticalityStyles: Record<
  BannerCriticality,
  { container: string; icon: typeof Info }
> = {
  [BannerCriticality.Info]: {
    container:
      'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
    icon: Info,
  },
  [BannerCriticality.Warning]: {
    container:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
    icon: AlertTriangle,
  },
  [BannerCriticality.Critical]: {
    container:
      'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
    icon: AlertCircle,
  },
};

interface BannerShellProps {
  criticality: BannerCriticality;
  onDismiss?: () => void;
  children: React.ReactNode;
}

export const BannerShell = ({
  criticality,
  onDismiss,
  children,
}: BannerShellProps) => {
  const style = criticalityStyles[criticality];
  const IconComponent = style.icon;

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 ${style.container}`}
      role='alert'
    >
      <IconComponent className='mt-0.5 h-5 w-5 flex-shrink-0' />
      <div className='flex-1 min-w-0'>{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className='flex-shrink-0 rounded-md p-1 hover:bg-current/10 transition-colors'
          aria-label='Dismiss banner'
        >
          <X className='h-4 w-4' />
        </button>
      )}
    </div>
  );
};
