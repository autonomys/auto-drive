'use client';

import { Banner, BannerCriticality, BannerInteractionType } from '@auto-drive/models';
import { X, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useCallback } from 'react';

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

interface BannerItemProps {
  banner: Banner;
  onInteract?: (bannerId: string, type: BannerInteractionType) => void;
  preview?: boolean;
}

export const BannerItem = ({ banner, onInteract, preview }: BannerItemProps) => {
  const style = criticalityStyles[banner.criticality];
  const IconComponent = style.icon;

  const handleDismiss = useCallback(() => {
    onInteract?.(banner.id, BannerInteractionType.Dismissed);
  }, [banner.id, onInteract]);

  const handleAcknowledge = useCallback(() => {
    onInteract?.(banner.id, BannerInteractionType.Acknowledged);
  }, [banner.id, onInteract]);

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 ${style.container}`}
      role='alert'
    >
      <IconComponent className='mt-0.5 h-5 w-5 flex-shrink-0' />
      <div className='flex-1 min-w-0'>
        <h3 className='font-semibold text-sm'>{banner.title}</h3>
        <p className='mt-1 text-sm whitespace-pre-wrap'>{banner.body}</p>
        {banner.requiresAcknowledgement && !preview && (
          <button
            onClick={handleAcknowledge}
            className='mt-2 rounded-md bg-current/10 px-3 py-1 text-xs font-medium hover:bg-current/20 transition-colors'
          >
            Acknowledge
          </button>
        )}
      </div>
      {banner.dismissable && !preview && (
        <button
          onClick={handleDismiss}
          className='flex-shrink-0 rounded-md p-1 hover:bg-current/10 transition-colors'
          aria-label='Dismiss banner'
        >
          <X className='h-4 w-4' />
        </button>
      )}
    </div>
  );
};
