'use client';

import { useRouteChange } from '@/hooks/useRouteChange';
import { useFileTableState } from '../../state';

export const TableRouteChangeListener = () => {
  const resetState = useFileTableState((e) => e.resetState);

  useRouteChange(() => {
    console.log('Route changed globally, resetting state!');
    resetState();
  });

  return null;
};
