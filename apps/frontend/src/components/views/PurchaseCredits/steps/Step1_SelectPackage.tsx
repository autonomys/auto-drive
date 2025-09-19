'use client';

import { Button, Card, cn } from '@auto-drive/ui';
import { CreditCurrentPrice } from '../CreditCurrentPrice';
import { usePrices } from '../../../../hooks/usePrices';

type PackageOption = {
  id: string;
  title: string;
  creditsInMB?: number;
  sizeLabel: string;
  popular?: boolean;
  features?: string[];
  buttonLabel?: string;
};

const PACKAGES: PackageOption[] = [
  {
    id: 'starter',
    title: 'Starter',
    creditsInMB: 10,
    sizeLabel: '10MB',
    features: ['Permanent storage', 'Instant activation', 'No expiration'],
  },
  {
    id: 'pro',
    title: 'Professional',
    creditsInMB: 100,
    sizeLabel: '100MB',
    popular: true,
    features: ['Permanent storage', 'Instant activation', 'No expiration'],
  },
  {
    id: 'ent',
    title: 'Enterprise',
    creditsInMB: 1024,
    sizeLabel: '1GB',
    features: ['Permanent storage', 'Instant activation', 'No expiration'],
  },
  {
    id: 'custom',
    title: 'Custom Amount',
    sizeLabel: 'Variable',
    popular: false,
    features: ['Choose your amount', 'Flexible pricing', 'Pay what you need'],
    buttonLabel: 'Configure',
  },
];

export const PurchaseStep1SelectPackage = ({
  onNext,
}: {
  onNext: (data: Record<string, unknown>) => void;
  context: Record<string, unknown>;
}) => {
  const { formatCreditsAsAi3, formatCreditsAsUsd } = usePrices();

  const CheckIcon = () => (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 20 20'
      fill='currentColor'
      className='h-4 w-4 text-primary'
      aria-hidden='true'
    >
      <path
        fillRule='evenodd'
        d='M16.704 5.29a1 1 0 0 1 .006 1.414l-7.2 7.25a1 1 0 0 1-1.43.01L3.3 9.49a1 1 0 1 1 1.403-1.424l4.07 4.01 6.492-6.523a1 1 0 0 1 1.439-.266z'
        clipRule='evenodd'
      />
    </svg>
  );

  return (
    <div className='grid grid-cols-1 gap-6 xl:grid-cols-4'>
      <div className='xl:col-span-4'>
        <CreditCurrentPrice />

        <h1 className='mt-6 text-2xl font-bold'>Buy Credits</h1>
        <h3 className='text-md text-muted-foreground'>
          Purchase storage credits using AI3 tokens
        </h3>

        <div className='mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {PACKAGES.map((p) => (
            <Card
              key={p.id}
              className={`cursor-pointer transition-all duration-300 ${
                p.popular
                  ? 'ring-2 ring-primary'
                  : 'hover:ring-2 hover:ring-primary'
              }`}
              onClick={() => onNext({ packageId: p.id })}
            >
              <div className='flex h-full flex-col gap-3 p-5'>
                <div className='flex items-center justify-between'>
                  <div className='text-sm font-medium'>{p.title}</div>
                  {p.popular && (
                    <span className='rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary'>
                      Most Popular
                    </span>
                  )}
                </div>
                <div className='text-3xl font-bold'>{p.sizeLabel}</div>
                {p.creditsInMB && (
                  <>
                    <div className='text-sm'>
                      {formatCreditsAsAi3(p.creditsInMB)} AI3
                    </div>
                    <div className='text-xs text-muted-foreground'>
                      ≈ ${formatCreditsAsUsd(p.creditsInMB)}
                    </div>
                  </>
                )}

                {p.features && (
                  <div className='mt-2 flex flex-col gap-2 text-sm'>
                    {p.features.map((f) => (
                      <div
                        key={f}
                        className='flex items-center gap-2 text-muted-foreground'
                      >
                        <CheckIcon />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className='mt-auto'>
                  <Button
                    variant={p.popular ? 'primary' : 'secondary'}
                    className={cn(
                      'w-full transition-all duration-300',
                      p.popular
                        ? 'hover:bg-primary-hover hover:text-primary-foreground'
                        : 'hover:bg-secondary-hover hover:text-secondary-foreground',
                    )}
                  >
                    {p.buttonLabel ?? 'Select Package'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className='mt-8 rounded-xl border bg-muted/30 p-6'>
          <div className='mb-4 text-lg font-semibold'>How it works</div>
          <div className='grid grid-cols-1 gap-8 md:grid-cols-3'>
            <div className='flex items-start gap-3'>
              <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground'>
                1
              </div>
              <div>
                <div className='font-medium'>Select Package</div>
                <div className='text-sm text-muted-foreground'>
                  Choose your storage amount or configure a custom package
                </div>
              </div>
            </div>
            <div className='flex items-start gap-3'>
              <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground'>
                2
              </div>
              <div>
                <div className='font-medium'>Connect Wallet</div>
                <div className='text-sm text-muted-foreground'>
                  Approve AI3 token transfer from your crypto wallet
                </div>
              </div>
            </div>
            <div className='flex items-start gap-3'>
              <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground'>
                3
              </div>
              <div>
                <div className='font-medium'>Instant Credits</div>
                <div className='text-sm text-muted-foreground'>
                  Once transaction is confirmed (12 confirmations) you will
                  receive your credits
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
