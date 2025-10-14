'use client';

import { Button, Card, ROUTES } from '@auto-drive/ui';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import { usePrices } from '../../../../hooks/usePrices';
import { shortenString } from '../../../../utils/misc';
import { CopiableText } from '../../../atoms/CopiableText';

export const PurchaseStep4Success = ({
  context,
}: {
  context: Record<string, unknown>;
}) => {
  const { formatCreditsInMbAsAi3 } = usePrices();

  const sizeMB = context.sizeMB as number;

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
                  value={<span>{sizeMB}MiB</span>}
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
                      {Number(context.sizeMB)} MiB
                    </span>
                  }
                />
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
