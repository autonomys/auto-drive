import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ScopeStore {
  scope: 'user' | 'global';
  setScope: (scope: 'user' | 'global') => void;
}

export const useScopeStore = create<ScopeStore>()(
  persist(
    (set) => ({
      scope: 'global',
      setScope: (scope: 'user' | 'global') => set({ scope }),
    }),
    { name: 'scope-storage', version: 1 },
  ),
);
