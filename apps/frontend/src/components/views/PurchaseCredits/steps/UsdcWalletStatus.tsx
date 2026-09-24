import { Button } from '@auto-drive/ui';
import type { UsdcPurchaseStage } from '../../../../hooks/useUsdcPurchase';

const progress: Partial<Record<UsdcPurchaseStage, string>> = {
  checking: 'Checking your wallet and payment options…',
  switching: 'Confirm the network switch in your wallet.',
  approving:
    'Confirm USDC approval in your wallet. Approval gives permission to pay; it does not send USDC yet.',
  'approval-confirming':
    'Waiting for USDC approval to confirm. Your wallet will then ask you to confirm the payment.',
  paying: 'Confirm the payment in your wallet to finish your purchase.',
  batching: 'Confirm approval and payment together in your wallet.',
};

export const UsdcWalletStatus = ({
  stage,
  quoteExpired,
  isBusy,
  mayHaveBroadcast,
  hasTxHash,
  hasBatch,
  hasKnownPayment,
  batchStatusUnavailable,
  batchWalletConnected,
  onAcknowledge,
}: {
  stage: UsdcPurchaseStage;
  quoteExpired: boolean;
  isBusy: boolean;
  mayHaveBroadcast: boolean;
  hasTxHash: boolean;
  hasBatch: boolean;
  hasKnownPayment: boolean;
  batchStatusUnavailable: boolean;
  batchWalletConnected: boolean;
  onAcknowledge: () => void;
}) => {
  if (hasTxHash) return null;
  if (hasKnownPayment) {
    return (
      <div role='status' className='rounded-md bg-muted p-3 text-sm'>
        A payment has already been recorded for this purchase. Do not pay again.
        Check your credits or contact support if they have not arrived.
      </div>
    );
  }
  if (isBusy) {
    if (quoteExpired) {
      return (
        <div
          role='alert'
          className='rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'
        >
          <strong>Price lock expired.</strong>{' '}
          {stage === 'paying' || stage === 'batching'
            ? 'Reject any unconfirmed payment request in your wallet. This page cannot cancel it. If you already confirmed, do not pay again; we will keep tracking your payment.'
            : stage === 'approval-confirming'
              ? 'Your USDC approval may still confirm, but we will not request payment for this quote. Get a fresh quote once approval finishes.'
              : 'Reject any open wallet request. We will not request payment for this quote. Get a fresh quote once the current request finishes.'}
        </div>
      );
    }
    return progress[stage] ? (
      <div role='status' className='text-sm text-muted-foreground'>
        {progress[stage]}
      </div>
    ) : null;
  }
  if (hasBatch) {
    return (
      <div role='status' className='rounded-md bg-muted p-3 text-sm'>
        {!batchWalletConnected
          ? 'Reconnect the wallet you used to pay so we can check your payment.'
          : batchStatusUnavailable
            ? 'Your wallet has not provided the payment result yet. We are checking automatically. Do not send another payment.'
            : 'Your payment is processing. We are checking your wallet for confirmation.'}
        {quoteExpired && (
          <p className='mt-2'>
            The price lock has expired. If your wallet is still asking for
            payment confirmation, reject that request. If the payment is already
            pending or complete, do not pay again; we will keep tracking it.
          </p>
        )}
      </div>
    );
  }
  if (!mayHaveBroadcast) return null;
  return (
    <div
      role='alert'
      className='rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'
    >
      <strong>Check your wallet before paying again.</strong> Your wallet did
      not return a transaction, so we cannot tell whether the payment was sent.
      If you see a pending or completed USDC payment, do not pay again. Keep its
      transaction details for support and check your credits shortly.
      <div className='mt-2'>
        <Button variant='outline' onClick={onAcknowledge}>
          My wallet shows nothing was sent
        </Button>
      </div>
    </div>
  );
};
