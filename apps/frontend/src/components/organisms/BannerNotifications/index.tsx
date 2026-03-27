'use client';

import { useCallback, useEffect } from 'react';
import { BannerInteractionType } from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { useBannerStore } from 'globalStates/banners';
import { useUserStore } from 'globalStates/user';
import { BannerItem } from './BannerItem';

export const BannerNotifications = () => {
  const { api } = useNetwork();
  const user = useUserStore((s) => s.user);
  const { banners, setBanners, removeBanner } = useBannerStore();

  useEffect(() => {
    if (!user) {
      setBanners([]);
      return;
    }

    api.getActiveBanners().then(setBanners).catch(() => setBanners([]));
  }, [api, user, setBanners]);

  const handleInteract = useCallback(
    async (bannerId: string, type: BannerInteractionType) => {
      try {
        await api.interactWithBanner(bannerId, type);
        removeBanner(bannerId);
      } catch {
        // Silently fail — banner stays visible
      }
    },
    [api, removeBanner],
  );

  if (banners.length === 0) return null;

  return (
    <>
      {banners.map((banner) => (
        <BannerItem
          key={banner.id}
          banner={banner}
          onInteract={handleInteract}
        />
      ))}
    </>
  );
};
