'use client';

import { Button } from '@auto-drive/ui';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import { useCallback, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { CreditCurrentPrice } from '../CreditCurrentPrice';
import { GoBackButton } from '../../../atoms/GoBackButton';
import { usePrices } from '../../../../hooks/usePrices';

export const PurchaseStep2ConnectWallet = ({
  onNext,
  onBack,
  context,
  onContextChange,
}: {
  onNext: (data?: Record<string, unknown>) => void;
  onBack: () => void;
  context: Record<string, unknown>;
  onContextChange: (data: Record<string, unknown>) => void;
}) => {
  const {
    formatCreditsInMbAsUsd,
    formatAi3AsCreditsInMb,
    formatCreditsInMbAsAi3,
  } = usePrices();

  const isCustom = String(context.packageId ?? 'custom') === 'custom';

  const { title, sizeMB } = useMemo(() => {
    const id = String(context.packageId ?? 'custom');
    switch (id) {
      case 'starter':
        return {
          title: 'Starter',
          sizeMB: 10,
        };
      case 'pro':
        return {
          title: 'Professional Package',
          sizeMB: 100,
        };
      case 'ent':
        return {
          title: 'Enterprise',
          sizeMB: 1024,
        };
      default:
        return {
          title: 'Custom Amount',
          sizeMB: (context.sizeMB as number) ?? 0,
        };
    }
  }, [context.packageId, context.sizeMB]);

  const onChangeMb = useCallback(
    (value: string) => {
      const mb = Math.max(0, Number(value) || 0);
      onContextChange({ sizeMB: mb });
    },
    [onContextChange],
  );

  const onChangeAi3 = useCallback(
    (value: string) => {
      const mb = formatAi3AsCreditsInMb(Number(value));
      onContextChange({ sizeMB: mb });
    },
    [formatAi3AsCreditsInMb, onContextChange],
  );

  return (
    <div className='flex flex-col gap-4'>
      <div>
        <GoBackButton onClick={onBack} />
      </div>
      <CreditCurrentPrice />
      <div className='grid grid-cols-1 gap-4 xl:grid-cols-3'>
        <div className='xl:col-span-2'>
          <div className='flex flex-col gap-3 p-4'>
            <Section
              title={
                <div className='flex items-center gap-2'>
                  <Zap className='h-5 w-5 text-primary' />
                  Order Details
                </div>
              }
            >
              <div className='flex items-center justify-between rounded-md bg-muted p-4'>
                <div className='flex flex-col'>
                  <div className='text-sm font-medium'>{title}</div>
                  <div className='text-xs text-muted-foreground'>
                    Permanent storage credits
                  </div>
                </div>
                <div className='text-right'>
                  <div className='text-xl font-bold'>{sizeMB}MB</div>
                  <div className='text-xs text-muted-foreground'>Storage</div>
                </div>
              </div>

              <InfoRow
                label='Storage Amount'
                value={
                  isCustom ? (
                    <input
                      type='number'
                      min={0}
                      step={1}
                      className='w-28 rounded-md border px-2 py-1 text-right'
                      value={Number(sizeMB) || 0}
                      onChange={(e) => onChangeMb(e.target.value)}
                    />
                  ) : (
                    <span>{sizeMB}MB</span>
                  )
                }
              />
              <InfoRow
                label='AI3 Token Amount'
                value={
                  isCustom ? (
                    <input
                      style={{ appearance: 'none', MozAppearance: 'textfield' }}
                      type='number'
                      min={0}
                      step={1}
                      className='w-28 rounded-md border px-2 py-1 text-right'
                      value={formatCreditsInMbAsAi3(Number(sizeMB))}
                      onChange={(e) => onChangeAi3(e.target.value)}
                    />
                  ) : (
                    <span>
                      {formatCreditsInMbAsAi3(Number(sizeMB)).toFixed(2)} AI3
                    </span>
                  )
                }
              />
              <InfoRow
                label='USD Equivalent'
                value={
                  <span>
                    ${formatCreditsInMbAsUsd(Number(sizeMB)).toFixed(2)}
                  </span>
                }
              />
              <div className='flex flex-col rounded-md border-b-2 border-gray-200' />
              <div className='mt-2'>
                <InfoRow
                  label='Total'
                  value={
                    <span className='font-semibold'>
                      {formatCreditsInMbAsAi3(Number(sizeMB)).toFixed(2)} AI3
                    </span>
                  }
                  accent
                />
              </div>
            </Section>
          </div>
        </div>

        <div className='xl:col-span-1'>
          <Section title='Complete Payment'>
            <div className='flex flex-col gap-3 p-4'>
              <InfoRow
                label='Current Balance'
                className='rounded-md bg-gray-100 p-4'
                value={<span>0 AI3</span>}
              />
              <InfoRow
                label='After Purchase'
                value={<span className='font-semibold'>{sizeMB}MB</span>}
                className='rounded-md bg-primary/20 p-4'
                accent
              />
              <div className='flex gap-3 pt-2'>
                <Button variant='outline' onClick={onBack} className='w-1/3'>
                  Back
                </Button>
                <Button
                  onClick={() => {
                    onNext({ sizeMB });
                  }}
                  className='w-2/3'
                >
                  Confirm Purchase
                </Button>
              </div>
              <div className='text-xs text-muted-foreground'>
                Next, you will connect your wallet to complete the AI3 token
                transfer
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};
