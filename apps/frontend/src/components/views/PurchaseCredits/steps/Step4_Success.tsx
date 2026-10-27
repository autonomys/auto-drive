'use client';

import { Button, Card, ROUTES } from '@auto-drive/ui';
import { PaymentMethod, USDC_DECIMALS } from '@auto-drive/models';
import { useQuery } from '@tanstack/react-query';
import { formatEther } from 'viem';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import { useNetwork } from '../../../../contexts/network';
import { readPaymentMethod } from '../../../../utils/purchaseCredits';
import { formatUsdcAmount } from '../../../../utils/usdc';
import { shortenString } from '../../../../utils/misc';
import { CopiableText } from '../../../atoms/CopiableText';
import { useUserStore } from '../../../../globalStates/user';
import { formatStorageSize } from '../../../../utils/number';

export const PurchaseStep4Success = ({
  context,
}: {
  context: Record<string, unknown>;
}) => {
  const { api, network } = useNetwork();
  const intentId =
    typeof context.intentId === 'string' ? context.intentId : undefined;
  // Receipts use the settled amount, which can differ from the quote. Keeping
  // the intent ID in the URL also makes this work after a reload or batch resume.
  const {
    data: receipt,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['paymentReceipt', network.id, intentId],
    queryFn: () => api.getIntent(intentId!),
    enabled: Boolean(intentId),
    retry: false,
  });
  const isUsdc =
    readPaymentMethod(receipt?.paymentMethod ?? context.paymentMethod) ===
    PaymentMethod.USDC_ETH;
  const currency = isUsdc ? 'USDC' : 'AI3';
  const baseUnits = isUsdc ? receipt?.tokenAmount : receipt?.paymentAmount;
  const amountPaid =
    baseUnits == null
      ? null
      : isUsdc
        ? formatUsdcAmount(BigInt(baseUnits), USDC_DECIMALS)
        : formatEther(BigInt(baseUnits));
  const txHash = receipt?.txHash ?? context.txHash;

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
                  value={
                    <span>{formatStorageSize(sizeMB * 1024 * 1024, 2)}</span>
                  }
                />
                <InfoRow
                  label={`${currency} Paid`}
                  className='items-center font-bold'
                  value={
                    <span className='flex items-center gap-2'>
                      <span className='font-bold'>
                        {amountPaid !== null
                          ? `${amountPaid} ${currency}`
                          : isLoading
                            ? 'Loading…'
                            : 'Unavailable'}
                      </span>
                      {isError && (
                        <button
                          type='button'
                          className='text-sm underline'
                          onClick={() => void refetch()}
                        >
                          Retry
                        </button>
                      )}
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
                    typeof txHash === 'string' && txHash ? (
                      <CopiableText
                        text={txHash}
                        displayText={shortenString(txHash, 10)}
                        copyButtonClassName='text-primary hover:text-primary/80'
                      />
                    ) : (
                      <span>Unavailable</span>
                    )
                  }
                />
                <InfoRow
                  label='Credits Added'
                  value={
                    <span className='font-bold text-primary'>
                      {formatStorageSize(sizeMB * 1024 * 1024, 2)}
                    </span>
                  }
                />
                {newPurchasedBalance !== null && (
                  <InfoRow
                    label='New Purchased Credits Total'
                    value={
                      <span className='font-bold text-primary'>
                        {formatStorageSize(newPurchasedBalance, 2)}
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
