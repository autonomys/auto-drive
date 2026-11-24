'use client';

import Link from 'next/link';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { CreditCard, Gift } from 'lucide-react';
import { Button, ROUTES } from '@auto-drive/ui';
import { OrganizationOverview } from '@auto-drive/models';
import { useNetwork } from '@/contexts/network';
import { useUserStore } from '@/globalStates/user';
import { formatBytes } from '@/utils/number';

dayjs.extend(utc);

const bytes = (value: string) => formatBytes(Number(value), 2);
const day = (date: dayjs.Dayjs | string) => dayjs(date).format('MMM D, YYYY');

const Card = ({
  icon: Icon,
  title,
  amount,
  children,
}: {
  icon: typeof CreditCard;
  title: string;
  amount: string;
  children: React.ReactNode;
}) => (
  <div className='rounded-lg border border-gray-200 p-4'>
    <div className='flex items-center justify-between gap-2'>
      <p className='flex items-center gap-2 text-sm font-medium'>
        <Icon className='h-4 w-4 text-gray-500' />
        {title}
      </p>
      <p className='font-semibold'>{amount} left</p>
    </div>
    <div className='mt-2 space-y-1 text-xs text-gray-500'>{children}</div>
  </div>
);

/** What the organization's account has left to upload with, and its terms. */
export const OrganizationCredits = ({
  overview,
}: {
  overview: OrganizationOverview;
}) => {
  const { network } = useNetwork();
  const canSeeHistory = useUserStore((state) => !!state.features.buyCredits);
  const { credits } = overview;
  const monthly = Number(credits.monthlyFreeUploadBytes);
  const hasFreeCredits =
    monthly > 0 || Number(credits.freeCreditBytesRemaining) > 0;
  // Monthly free credits are issued at the start of each UTC month.
  const nextIssue = dayjs.utc().add(1, 'month').startOf('month');

  return (
    <section className='rounded-lg border border-gray-200 bg-background p-6'>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-lg font-semibold'>Credits</h2>
        <div className='flex gap-2'>
          {canSeeHistory && (
            <Link href={ROUTES.credits(network.id)}>
              <Button variant='outline' size='sm'>
                Credit history
              </Button>
            </Link>
          )}
          <Link href={ROUTES.purchase(network.id)}>
            <Button variant='primary' size='sm'>
              Buy credits
            </Button>
          </Link>
        </div>
      </div>
      <p className='mb-4 text-sm text-gray-500'>
        Shared by every member and API key of {overview.name}.
        {hasFreeCredits && ' Free credits are used before purchased ones.'}
      </p>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        {hasFreeCredits && (
          <Card
            icon={Gift}
            title='Free credits'
            amount={bytes(credits.freeCreditBytesRemaining)}
          >
            {monthly > 0 ? (
              <p>
                {bytes(credits.monthlyFreeUploadBytes)} every month. This
                month&apos;s expire and the next are issued on{' '}
                {day(nextIssue.local())}.
              </p>
            ) : (
              <p>Granted to {overview.name} at no cost.</p>
            )}
          </Card>
        )}
        <Card
          icon={CreditCard}
          title='Purchased credits'
          amount={bytes(credits.purchasedBytesRemaining)}
        >
          {credits.purchasedNextExpiry && (
            <p className='text-amber-600 dark:text-amber-400'>
              Next expiry: {day(credits.purchasedNextExpiry)}
            </p>
          )}
          <p>
            The account can hold up to {bytes(credits.maxPurchasedBytes)} of
            purchased credits at once. Each purchase lasts{' '}
            {credits.creditExpiryDays} days.
          </p>
        </Card>
      </div>
    </section>
  );
};
