'use client';

import { HelpCircleIcon, HomeIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCallback } from 'react';
import Link from 'next/link';
export const LandingHeader = () => {
  const pathname = usePathname();

  const getLinkClass = useCallback(
    (path: string) => {
      return `rounded-lg px-8 py-2 font-medium ${
        pathname === path
          ? 'bg-white dark:bg-darkWhite dark:text-darkBlack'
          : 'bg-transparent hover:cursor-pointer dark:text-darkBlack'
      }`;
    },
    [pathname],
  );

  return (
    <div className='flex w-full flex-row justify-center gap-2 bg-transparent px-[20%] py-2'>
      <ul className='flex flex-row gap-4'>
        <Link className='content' href='/'>
          <li className={getLinkClass('/')}>
            <HomeIcon className='h-4 w-4' />
          </li>
        </Link>
        <Link className='content' href='/faqs'>
          <li className={getLinkClass('/faqs')}>
            <HelpCircleIcon className='h-4 w-4' />
          </li>
        </Link>
      </ul>
    </div>
  );
};
