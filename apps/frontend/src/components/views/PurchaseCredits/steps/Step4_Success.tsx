'use client';

import { Button, Card, ROUTES } from '@auto-drive/ui';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import { useNetwork } from '@/contexts/network';
import { usePrices } from '../../../../hooks/usePrices';
import { shortenString } from '../../../../utils/misc';

export const PurchaseStep4Success = ({
  context,
}: {
  context: Record<string, unknown>;
}) => {
  const { network } = useNetwork();

  const { formatCreditsAsAi3 } = usePrices();
  return (
    <div className='flex flex-col gap-4'>
      <Section title='Payment Successful!'>
        <Card>
          <div className='flex flex-col gap-3 p-4'>
            <div className='rounded-md bg-green-50 p-4'>
              <div className='grid grid-cols-2 gap-2'>
                <InfoRow
                  className='items-center font-bold'
                  label='Storage Added'
                  value={<span>1GB</span>}
                />
                <InfoRow
                  label='AI3 Paid'
                  className='items-center font-bold'
                  value={
                    <span className='font-bold'>
                      {formatCreditsAsAi3(Number(context.sizeMB))} AI3
                    </span>
                  }
                />
                <InfoRow
                  label='Status'
                  className='items-center font-bold'
                  value={
                    <span className='font-bold text-primary'>Completed</span>
                  }
                />
                <InfoRow
                  label='Transaction Hash'
                  className='items-center font-bold'
                  value={
                    <span className='font-bold'>
                      {shortenString((context.txHash as string) || '0x...', 10)}
                    </span>
                  }
                />
              </div>
            </div>

            <div className='grid grid-cols-2 gap-2'>
              <InfoRow
                label='Credits Added'
                value={
                  <span className='font-bold text-primary'>
                    {Number(context.sizeMB)} MB
                  </span>
                }
              />
            </div>
            <div className='flex gap-3'>
              <a href={ROUTES.drive(network.id)} className='contents'>
                <Button>Continue to Dashboard</Button>
              </a>
            </div>
          </div>
        </Card>
      </Section>
    </div>
  );
};
