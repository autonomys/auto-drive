'use client';

import { useEffect, useState } from 'react';
import { Button } from '@auto-drive/ui';
import { AlertTriangle, X } from 'lucide-react';
// Same regex the backend validates with — the backend rejects anything else
// and the batch is NOT marked as refunded.
import { EVM_TX_HASH_REGEX } from '@auto-drive/models';

/**
 * Modal that collects the mandatory on-chain refund transaction hash before
 * marking one or more credit batches as refunded. The confirm button stays
 * disabled until a validly-formatted hash is entered, so a refund can never
 * be recorded without one. When several batches are refunded together the
 * same hash is recorded on each (one AI3 transfer covers them all).
 */
export const RefundTxHashModal = ({
  batchCount,
  suggestedRefundAi3,
  isSubmitting,
  errorMessage,
  onConfirm,
  onClose,
}: {
  batchCount: number;
  /**
   * Informational pro-rated refund suggestion (unused bytes × locked
   * price), pre-formatted as an AI3 amount. The system does not enforce
   * the transferred amount — the transfer happens out-of-band.
   */
  suggestedRefundAi3?: string | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: (refundTxHash: string) => void;
  onClose: () => void;
}) => {
  const [txHash, setTxHash] = useState('');
  const trimmed = txHash.trim();
  const isValid = EVM_TX_HASH_REGEX.test(trimmed);
  const showFormatHint = trimmed.length > 0 && !isValid;

  // Close on Escape (unless a submission is in flight).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onClose]);

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
      role='dialog'
      aria-modal='true'
    >
      <div className='w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl'>
        <div className='mb-4 flex items-start justify-between'>
          <div className='flex items-center gap-2'>
            <AlertTriangle className='h-5 w-5 text-orange-500' />
            <h3 className='text-lg font-semibold'>
              {batchCount === 1
                ? 'Mark batch as refunded'
                : `Mark ${batchCount} batches as refunded`}
            </h3>
          </div>
          <button
            type='button'
            onClick={onClose}
            disabled={isSubmitting}
            className='text-muted-foreground hover:text-foreground disabled:opacity-50'
            aria-label='Close'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <p className='mb-4 text-sm text-muted-foreground'>
          Enter the transaction hash of the on-chain AI3 refund transfer.
          {batchCount > 1 &&
            ' The same hash will be recorded on every selected batch.'}{' '}
          A refund cannot be recorded without it. Marking as refunded voids
          the entire remaining balance of the selected{' '}
          {batchCount === 1 ? 'batch' : 'batches'}.
        </p>

        {suggestedRefundAi3 && (
          <p className='mb-4 rounded border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground'>
            Suggested pro-rated refund:{' '}
            <span className='font-mono font-medium text-foreground'>
              {suggestedRefundAi3}
            </span>{' '}
            (unused storage × locked purchase price). Informational only —
            the transferred amount is not verified.
          </p>
        )}

        <label htmlFor='refundTxHash' className='mb-1 block text-sm'>
          Refund transaction hash
        </label>
        <input
          id='refundTxHash'
          type='text'
          value={txHash}
          onChange={(e) => setTxHash(e.target.value)}
          placeholder='0x…'
          spellCheck={false}
          className='bg-background-hover text-foreground-hover w-full rounded border px-3 py-2 font-mono text-xs'
        />
        {showFormatHint && (
          <p className='mt-1 text-xs text-red-500'>
            Expected format: 0x followed by 64 hex characters.
          </p>
        )}
        {errorMessage && (
          <p className='mt-2 text-sm text-red-500'>{errorMessage}</p>
        )}

        <div className='mt-6 flex justify-end gap-2'>
          <Button variant='outline' onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant='primary'
            disabled={!isValid || isSubmitting}
            onClick={() => onConfirm(trimmed)}
          >
            {isSubmitting
              ? 'Marking…'
              : batchCount === 1
                ? 'Mark Refunded'
                : `Mark ${batchCount} Refunded`}
          </Button>
        </div>
      </div>
    </div>
  );
};
