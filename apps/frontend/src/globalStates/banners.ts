import { create } from 'zustand';
import { Banner } from '@auto-drive/models';

interface BannerStore {
  banners: Banner[];
  loading: boolean;
  setBanners: (banners: Banner[]) => void;
  setLoading: (loading: boolean) => void;
  removeBanner: (bannerId: string) => void;
}

export const useBannerStore = create<BannerStore>()((set) => ({
  banners: [],
  loading: false,
  setBanners: (banners: Banner[]) => set({ banners }),
  setLoading: (loading: boolean) => set({ loading }),
  removeBanner: (bannerId: string) =>
    set((state) => ({
      banners: state.banners.filter((b) => b.id !== bannerId),
    })),
}));
