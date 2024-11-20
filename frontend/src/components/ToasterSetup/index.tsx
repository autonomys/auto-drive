'use client';

import { Toaster } from 'react-hot-toast';
import { useMediaQuery } from 'usehooks-ts';

export const ToasterSetup = () => {
  const isMobile = useMediaQuery('(max-width: 768px)');

  return <Toaster position={isMobile ? 'top-center' : 'bottom-left'} />;
};
