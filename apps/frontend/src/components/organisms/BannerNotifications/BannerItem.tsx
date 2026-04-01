'use client';

import { Banner, BannerInteractionType } from '@auto-drive/models';
import { useCallback } from 'react';
import { BannerShell } from './BannerShell';

interface BannerItemProps {
  banner: Banner;
  onInteract?: (bannerId: string, type: BannerInteractionType) => void;
  preview?: boolean;
}

export const BannerItem = ({ banner, onInteract, preview }: BannerItemProps) => {
  const handleDismiss = useCallback(() => {
    onInteract?.(banner.id, BannerInteractionType.Dismissed);
  }, [banner.id, onInteract]);

  const handleAcknowledge = useCallback(() => {
    onInteract?.(banner.id, BannerInteractionType.Acknowledged);
  }, [banner.id, onInteract]);

  return (
    <BannerShell
      criticality={banner.criticality}
      onDismiss={banner.dismissable && !preview ? handleDismiss : undefined}
    >
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
    </BannerShell>
  );
};
