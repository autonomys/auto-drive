import { create } from 'zustand';
import { TouStatus } from '@auto-drive/models';

interface TouStore {
  touStatus: TouStatus | null;
  setTouStatus: (status: TouStatus | null) => void;
}

export const useTouStore = create<TouStore>()((set) => ({
  touStatus: null,
  setTouStatus: (status: TouStatus | null) => set({ touStatus: status }),
}));
