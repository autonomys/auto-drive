import { create } from 'zustand';
import { DeletionRequest } from '@auto-drive/models';

interface DeletionStore {
  deletionRequest: DeletionRequest | null;
  setDeletionRequest: (request: DeletionRequest | null) => void;
}

export const useDeletionStore = create<DeletionStore>()((set) => ({
  deletionRequest: null,
  setDeletionRequest: (request: DeletionRequest | null) =>
    set({ deletionRequest: request }),
}));
