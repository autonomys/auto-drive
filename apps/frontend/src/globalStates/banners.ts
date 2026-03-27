import { create } from 'zustand';
import { Banner } from '@auto-drive/models';

interface BannerStore {
  banners: Banner[];
  setBanners: (banners: Banner[]) => void;
  removeBanner: (bannerId: string) => void;
}

export const useBannerStore = create<BannerStore>()((set) => ({
  banners: [],
  setBanners: (banners: Banner[]) => set({ banners }),
  removeBanner: (bannerId: string) =>
    set((state) => ({
      banners: state.banners.filter((b) => b.id !== bannerId),
    })),
}));
