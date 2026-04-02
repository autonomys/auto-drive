'use client';

import { Button, Card, ROUTES } from '@auto-drive/ui';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import { usePrices } from '../../../../hooks/usePrices';
import { shortenString } from '../../../../utils/misc';
import { CopiableText } from '../../../atoms/CopiableText';
import { useUserStore } from '../../../../globalStates/user';
import { formatBytes } from '../../../../utils/number';

export const PurchaseStep4Success = ({
  context,
}: {
  context: Record<string, unknown>;
}) => {
  const { formatCreditsInMbAsAi3 } = usePrices();

  const sizeMB = context.sizeMB as number;

  // creditSummary is invalidated by useTransactionConfirmation once the
  // backend marks the intent as completed, so by the time Step 4 renders
  // the store should already hold the updated balance.
  // We show it only when it has loaded and is non-zero to avoid showing
  // "0 B" to free-tier users who somehow reach this page edge-case.
  const newPurchasedBalance = useUserStore((s) => {
    if (!s.creditSummary) return null;
    const bytes = Number(s.creditSummary.uploadBytesRemaining);
    return bytes > 0 ? bytes : null;
  });

  return (
    <div className='flex flex-col gap-4'>
      <Section title='Payment Successful!'>
        <Card>
          <div className='flex flex-col gap-3 p-4'>
            <div className='rounded-md bg-green-100 p-4 text-primary dark:bg-green-300'>
              <div className='grid grid-cols-2 gap-2'>
                <InfoRow
                  className='items-center font-bold'
                  label='Storage Added'
                  value={<span>{sizeMB} MB</span>}
                />
                <InfoRow
                  label='AI3 Paid'
                  className='items-center font-bold'
                  value={
                    <span className='font-bold'>
                      {formatCreditsInMbAsAi3(Number(context.sizeMB)).toFixed(
                        2,
                      )}{' '}
                      AI3
                    </span>
                  }
                />
                <InfoRow
                  label='Status'
                  className='items-center font-bold'
                  value={<span className='font-bold'>Completed</span>}
                />
                <InfoRow
                  label='Transaction Hash'
                  className='items-center font-bold'
                  value={
                    <CopiableText
                      text={(context.txHash as string) || '0x...'}
                      displayText={shortenString(
                        (context.txHash as string) || '0x...',
                        10,
                      )}
                      copyButtonClassName='text-primary hover:text-primary/80'
                    />
                  }
                />
                <InfoRow
                  label='Credits Added'
                  value={
                    <span className='font-bold text-primary'>
                      {Number(context.sizeMB)} MB
                    </span>
                  }
                />
                {newPurchasedBalance !== null && (
                  <InfoRow
                    label='New Purchased Credits Total'
                    value={
                      <span className='font-bold text-primary'>
                        {formatBytes(newPurchasedBalance, 2)}
                      </span>
                    }
                  />
                )}
              </div>
            </div>

            <div className='flex gap-3'>
              <a href={ROUTES.drive()} className='contents'>
                <Button>Continue to Dashboard</Button>
              </a>
            </div>
          </div>
        </Card>
      </Section>
    </div>
  );
};
