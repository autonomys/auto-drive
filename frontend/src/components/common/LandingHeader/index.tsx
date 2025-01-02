'use client';

import { usePathname } from 'next/navigation';
import { useCallback } from 'react';

export const LandingHeader = () => {
  const pathname = usePathname();

  const getLinkClass = useCallback(
    (path: string) => {
      return `rounded-lg px-8 py-[1px] font-medium ${
        pathname === path ? 'bg-white' : 'bg-transparent hover:cursor-pointer'
      }`;
    },
    [pathname],
  );

  return (
    <div className='flex w-full flex-row justify-center gap-2 bg-transparent px-[20%] py-2'>
      <ul className='flex flex-row gap-4'>
        <a className='content' href='/'>
          <li className={getLinkClass('/')}>Home</li>
        </a>
        <a className='content' href='/faqs'>
          <li className={getLinkClass('/faqs')}>FAQs</li>
        </a>
      </ul>
    </div>
  );
};
