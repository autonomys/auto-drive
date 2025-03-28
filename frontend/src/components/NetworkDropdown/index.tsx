'use client';

import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Transition,
} from '@headlessui/react';
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/20/solid';
import { Network, networks } from 'constants/networks';
import { FC, Fragment } from 'react';
import { AutonomysSymbol } from 'components/common/AutonomysSymbol';
import { cn } from 'utils/cn';

export const NetworkDropdown: FC<{
  selected: Network;
  onChange: (network: Network) => void;
}> = ({ selected, onChange }) => {
  const isActive = (selected: Network, network: Network) => {
    if (selected.id === network.id) {
      return true;
    }
    return false;
  };

  return (
    <Listbox value={selected} onChange={onChange}>
      <div className='relative mt-1 w-36'>
        <ListboxButton className='relative w-full cursor-default rounded-lg bg-white py-2 pl-3 pr-10 text-left shadow-md focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm dark:bg-darkWhite dark:ring-1 dark:ring-darkBlackHover'>
          <div className='flex items-center space-x-2'>
            <AutonomysSymbol />
            <span className='ml-2 block'>{selected.name}</span>
            <span className='pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2'>
              <ChevronDownIcon
                className='ui-open:rotate-180 size-5 text-gray-400'
                aria-hidden='true'
              />
            </span>
          </div>
        </ListboxButton>
        <Transition
          as={Fragment}
          leave='transition ease-in duration-100'
          leaveFrom='opacity-100'
          leaveTo='opacity-0'
        >
          <ListboxOptions className='absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm dark:bg-darkWhite'>
            {Object.values(networks).map((network, personIdx) => (
              <ListboxOption
                key={personIdx}
                className={cn(
                  'relative flex cursor-default select-none items-center justify-start gap-2 bg-white py-2 pl-4 pr-4 dark:bg-darkWhite',
                  isActive(selected, network) ? 'bg-gray-100' : '',
                )}
                value={network}
              >
                <div className='flex'>
                  <AutonomysSymbol />
                  <span
                    className={cn(
                      'my-auto ml-2',
                      isActive(selected, network)
                        ? 'font-medium'
                        : 'font-normal',
                    )}
                  >
                    {network.name}
                  </span>
                  {isActive(selected, network) ? (
                    <span className='text-greenBright absolute inset-y-0 right-2 my-auto flex items-center'>
                      <CheckIcon
                        className='size-4 text-gray-400'
                        aria-hidden='true'
                      />
                    </span>
                  ) : null}
                </div>
              </ListboxOption>
            ))}
          </ListboxOptions>
        </Transition>
      </div>
    </Listbox>
  );
};
