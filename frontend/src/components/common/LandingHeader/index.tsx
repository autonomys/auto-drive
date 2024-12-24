'use client';

import { usePathname } from 'next/navigation';
import { useCallback } from 'react';

export const LandingHeader = () => {
  const pathname = usePathname();

  const getLinkClass = useCallback(
    (path: string) => {
      return `rounded-xl px-8 py-[1px] font-semibold ${
        pathname === path ? 'bg-white' : 'bg-transparent'
      }`;
    },
    [pathname],
  );

  return (
    <div className='flex w-full flex-row justify-center gap-2 bg-transparent px-[20%] py-2'>
      <ul className='flex flex-row gap-4'>
        <li className={getLinkClass('/')}>
          <a href='/'>Home</a>
        </li>
        <li className={getLinkClass('/faqs')}>
          <a href='/faqs'>FAQs</a>
        </li>
      </ul>
    </div>
  );
};
