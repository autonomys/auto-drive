'use client';

import { PaymentMethod } from '@auto-drive/models';
import { Coins, Info } from 'lucide-react';

/**
 * Pick what to pay with.
 *
 * Renders nothing at all when USDC is not on offer — deliberately, rather than a
 * disabled second option. A dead button is a promise the deployment cannot keep,
 * and the AI3-only screen is the one every user sees today; the selector should
 * be invisible in that case rather than present-and-inert.
 *
 * The single exception is a method that was available and is no longer, which is
 * `closedNotice` below: the user has already chosen USDC, so the option going
 * away needs a sentence rather than a silently vanishing radio button.
 */
export const PaymentMethodSelector = ({
  value,
  onChange,
  usdcAvailable,
  usdcChainName,
  closedNotice,
}: {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  usdcAvailable: boolean;
  usdcChainName: string | undefined;
  /**
   * Shown when USDC has closed under the user's feet. Kept generic on purpose:
   * which gate closed is an operational detail that belongs on the admin
   * dashboard, and a buyer's only useful next step is AI3.
   */
  closedNotice?: string | null;
}) => {
  if (!usdcAvailable && !closedNotice) return null;

  const options: {
    method: PaymentMethod;
    label: string;
    detail: string;
    disabled: boolean;
  }[] = [
    {
      method: PaymentMethod.AI3_NATIVE,
      label: 'AI3',
      detail: 'Native token on Auto EVM',
      disabled: false,
    },
    {
      method: PaymentMethod.USDC_ETH,
      label: 'USDC',
      // The chain comes from the deployment's own payment target, not from a
      // constant here — a test deployment settles on Sepolia and the screen
      // should say so rather than claim Ethereum.
      detail: usdcChainName
        ? `Stablecoin on ${usdcChainName}`
        : 'Stablecoin on Ethereum',
      disabled: !usdcAvailable,
    },
  ];

  return (
    <div className='flex flex-col gap-3 rounded-md border p-4'>
      <div className='flex items-center gap-2 text-sm font-medium'>
        <Coins className='h-4 w-4 text-primary' />
        Pay with
      </div>

      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
        {options.map((option) => {
          const selected = value === option.method;
          return (
            <button
              key={option.method}
              type='button'
              disabled={option.disabled}
              aria-pressed={selected}
              onClick={() => onChange(option.method)}
              className={`flex flex-col items-start rounded-md border px-4 py-3 text-left transition-colors ${
                selected
                  ? 'border-primary bg-primary/10'
                  : 'border-gray-200 hover:bg-muted dark:border-gray-700'
              } ${option.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span className='text-sm font-semibold'>{option.label}</span>
              <span className='text-xs text-muted-foreground'>
                {option.detail}
              </span>
            </button>
          );
        })}
      </div>

      {closedNotice && (
        <div className='flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground'>
          <Info className='mt-0.5 h-3.5 w-3.5 shrink-0' />
          <span>{closedNotice}</span>
        </div>
      )}
    </div>
  );
};
