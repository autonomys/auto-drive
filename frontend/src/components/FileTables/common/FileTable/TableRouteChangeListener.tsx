'use client';

import { useRouteChange } from '@/hooks/useRouteChange';
import { useFileTableState } from '../../state';

export const TableRouteChangeListener = () => {
  const resetState = useFileTableState((e) => e.resetState);

  useRouteChange(() => {
    resetState();
  });

  return null;
};
