import React, { useState, useRef, useEffect } from 'react';

import { useUserStore } from '@/globalStates/user';
import { LogOut, UserRoundIcon } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { CopiableText } from '@/components/atoms/CopiableText';
import { formatCid } from '@/utils/table';

export const ProfileDropdown: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useUserStore((state) => state);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => setIsOpen(!isOpen);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className='relative' ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className='my-auto flex items-center space-x-2 rounded-full focus:outline-none'
      >
        <div className='flex items-center space-x-2 rounded-full shadow-lg'>
          {user?.oauthAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user?.oauthAvatarUrl}
              alt='User avatar'
              className='h-9 w-9 rounded-full border border-gray-100 shadow-lg dark:border-gray-500'
            />
          ) : (
            <div className='flex h-9 w-9 items-center justify-center rounded-full border border-gray-100 bg-gray-300 text-white shadow-lg dark:border-gray-500 dark:bg-darkWhite'>
              <UserRoundIcon className='h-6 w-6' />
            </div>
          )}
        </div>
      </button>

      {isOpen && (
        <div className='absolute right-0 z-50 mt-2 w-48 origin-top-right rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-500 dark:bg-darkWhite'>
          <div className='border-b border-gray-100 px-4 py-3 dark:border-gray-700'>
            <p className='break-words text-sm font-medium'>
              {user?.oauthUsername || 'Anonymous'}
            </p>
            {user?.publicId && (
              <div className='pt-1 text-xs'>
                <CopiableText
                  text={user?.publicId}
                  displayText={formatCid(user?.publicId)}
                />
              </div>
            )}
          </div>
          <div className='py-1'>
            <button
              onClick={() => {
                signOut();
              }}
              className='flex w-full items-center gap-2 px-4 py-2 text-left text-base text-red-600 hover:bg-gray-50 dark:text-red-500 dark:hover:bg-darkWhiteHover'
            >
              Logout
              <LogOut className='h-4 w-4' />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
