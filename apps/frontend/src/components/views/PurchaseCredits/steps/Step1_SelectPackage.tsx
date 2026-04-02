'use client';

import { Button, Card, cn } from '@auto-drive/ui';
import { CreditCurrentPrice } from '../CreditCurrentPrice';
import { usePrices } from '../../../../hooks/usePrices';
import { usePaymentIntent } from '../../../../hooks/usePaymentIntent';
import { useUserStore } from '../../../../globalStates/user';
import { isPackageOverCap } from '../../../../utils/credits';

type PackageOption = {
  id: string;
  title: string;
  creditsInMB?: number;
  sizeLabel: string;
  popular?: boolean;
  /** Features that don't depend on runtime config (no expiry string here) */
  baseFeatures?: string[];
  buttonLabel?: string;
};

// Fallback used only before the credit summary API responds.
// The real value comes from CREDIT_EXPIRY_DAYS env-var via GET /credits/summary.
const DEFAULT_EXPIRY_DAYS = 90;

const PACKAGES: PackageOption[] = [
  {
    id: 'starter',
    title: 'Starter',
    creditsInMB: 10,
    sizeLabel: '10 MB',
    baseFeatures: ['Permanent storage', 'Instant activation'],
  },
  {
    id: 'pro',
    title: 'Professional',
    creditsInMB: 100,
    sizeLabel: '100 MB',
    popular: true,
    baseFeatures: ['Permanent storage', 'Instant activation'],
  },
  {
    id: 'ent',
    title: 'Enterprise',
    creditsInMB: 1024,
    sizeLabel: '1 GB',
    baseFeatures: ['Permanent storage', 'Instant activation'],
  },
  {
    id: 'custom',
    title: 'Custom Amount',
    sizeLabel: 'Variable',
    popular: false,
    baseFeatures: ['Choose your amount', 'Flexible pricing', 'Pay what you need'],
    buttonLabel: 'Configure',
  },
];

export const PurchaseStep1SelectPackage = ({
  onNext,
}: {
  onNext: (data: Record<string, unknown>) => void;
  context: Record<string, unknown>;
}) => {
  const { formatCreditsInMbAsAi3, formatCreditsInMbAsUsd } = usePrices();

  const { MINIMUM_CONFIRMATIONS } = usePaymentIntent();

  const creditSummary = useUserStore((s) => s.creditSummary);

  // Number of days credits are valid — sourced from CREDIT_EXPIRY_DAYS env-var
  // on the backend and returned by GET /credits/summary.  Falls back to the
  // default until the API responds (free-tier users loading the page).
  const expiryDays = creditSummary?.expiryDays ?? DEFAULT_EXPIRY_DAYS;

  // canPurchase is null when the summary hasn't loaded yet — allow in that case
  // so the UI is not blocked for users with no purchased credits (free tier).
  const purchaseBlocked =
    creditSummary !== null && creditSummary.canPurchase === false;

  // Maximum bytes the user may still purchase (string bigint from API)
  const maxPurchasableBytes = creditSummary
    ? BigInt(creditSummary.maxPurchasableBytes)
    : null;

  // Check whether a named package's size exceeds the user's remaining cap
  const checkPackageOverCap = (creditsInMB: number | undefined): boolean =>
    isPackageOverCap(creditsInMB, maxPurchasableBytes);

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

        {purchaseBlocked && (
          <div className='mt-4 rounded-md bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'>
            <strong>Credit cap reached.</strong> You have reached your maximum
            credit limit. Please use your existing credits before purchasing
            more.
          </div>
        )}

        <div className='mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {PACKAGES.map((p) => {
            // Named packages have a fixed size; disable them if they exceed the
            // remaining cap.  The "custom" package is never disabled here —
            // Step 2 validates the exact amount the user enters.
            const overCap =
              p.id !== 'custom' && checkPackageOverCap(p.creditsInMB);
            const disabled = purchaseBlocked || overCap;
            return (
              <Card
                key={p.id}
                className={`transition-all duration-300 ${
                  disabled
                    ? 'cursor-not-allowed opacity-50'
                    : `cursor-pointer ${
                        p.popular
                          ? 'ring-2 ring-primary'
                          : 'hover:ring-2 hover:ring-primary'
                      }`
                }`}
                onClick={() => {
                  if (!disabled) onNext({ packageId: p.id });
                }}
              >
                <div className='flex h-full flex-col gap-3 p-5'>
                  <div className='flex items-center justify-between'>
                    <div className='text-sm font-medium'>{p.title}</div>
                    {p.popular && !disabled && (
                      <span className='rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary'>
                        Most Popular
                      </span>
                    )}
                    {overCap && (
                      <span className='rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300'>
                        Exceeds cap
                      </span>
                    )}
                  </div>
                  <div className='text-3xl font-bold'>{p.sizeLabel}</div>
                  {p.creditsInMB && (
                    <>
                      <div className='text-sm'>
                        {formatCreditsInMbAsAi3(p.creditsInMB).toFixed(2)} AI3
                      </div>
                      <div className='text-xs text-muted-foreground'>
                        ≈ ${formatCreditsInMbAsUsd(p.creditsInMB).toFixed(2)}
                      </div>
                    </>
                  )}

                  {p.baseFeatures && (
                    <div className='mt-2 flex flex-col gap-2 text-sm'>
                      {[
                        ...p.baseFeatures,
                        // Append the server-driven expiry duration.
                        // Only shown for named (non-custom) packages that
                        // have a fixed credit amount.
                        ...(p.creditsInMB
                          ? [`Credits valid for ${expiryDays} days`]
                          : []),
                      ].map((f) => (
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
                      variant={p.popular && !disabled ? 'primary' : 'secondary'}
                      disabled={disabled}
                      className={cn(
                        'w-full transition-all duration-300',
                        !disabled && p.popular
                          ? 'hover:bg-primary-hover hover:text-primary-foreground'
                          : 'hover:bg-secondary-hover hover:text-secondary-foreground',
                      )}
                    >
                      {p.buttonLabel ?? 'Select Package'}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
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
                  Once transaction is confirmed ({MINIMUM_CONFIRMATIONS}{' '}
                  confirmations) you will receive your credits
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
