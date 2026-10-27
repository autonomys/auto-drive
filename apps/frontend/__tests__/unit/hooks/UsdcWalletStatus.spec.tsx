/** @jest-environment jsdom */
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { UsdcWalletStatus } from '../../../src/components/views/PurchaseCredits/steps/UsdcWalletStatus';
import type { UsdcPurchaseStage } from '../../../src/hooks/useUsdcPurchase';

jest.mock('@auto-drive/ui', () => ({
  Button: ({ children, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

const props = {
  stage: 'paying' as UsdcPurchaseStage,
  quoteExpired: false,
  isBusy: false,
  mayHaveBroadcast: true,
  hasTxHash: false,
  hasBatch: false,
  hasKnownPayment: false,
  batchStatusUnavailable: false,
  batchWalletConnected: true,
  onAcknowledge: jest.fn(),
};

describe('USDC wallet progress', () => {
  it('does not offer the nothing-sent acknowledgement for a server-known payment', () => {
    render(<UsdcWalletStatus {...props} hasKnownPayment />);
    expect(screen.getByRole('status').textContent).toMatch(
      /already been recorded/,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['paying', 'batching'] as const)(
    'asks the buyer to reject an expired %s prompt without offering another payment',
    (stage) => {
      render(<UsdcWalletStatus {...props} stage={stage} isBusy quoteExpired />);
      expect(screen.getByRole('alert').textContent).toMatch(
        /Reject any unconfirmed payment request/,
      );
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    },
  );

  it('explains that an approval can finish without sending an expired payment', () => {
    render(
      <UsdcWalletStatus
        {...props}
        stage='approval-confirming'
        isBusy
        quoteExpired
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /will not request payment/,
    );
  });
  it.each(['paying', 'batching'] as const)(
    'shows progress, not recovery, while %s',
    (stage) => {
      render(<UsdcWalletStatus {...props} stage={stage} isBusy />);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByRole('status').textContent).toMatch(/Confirm/);
    },
  );

  it('only asks the buyer to check for a payment after an uncertain failure', () => {
    render(<UsdcWalletStatus {...props} stage='quoted' />);
    expect(screen.getByRole('button').textContent).toBe(
      'My wallet shows nothing was sent',
    );
  });

  it('tracks a known batch without offering a resend acknowledgement', () => {
    render(
      <UsdcWalletStatus
        {...props}
        stage='batch-pending'
        hasBatch
        batchStatusUnavailable
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(
      /checking automatically/,
    );
  });

  it('warns about an expired pending batch without offering a fresh payment', () => {
    render(
      <UsdcWalletStatus
        {...props}
        stage='batch-pending'
        hasBatch
        quoteExpired
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(
      /reject that request/,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks for the original wallet when a pending batch was resumed disconnected', () => {
    render(
      <UsdcWalletStatus
        {...props}
        stage='batch-pending'
        hasBatch
        batchWalletConnected={false}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/Reconnect/);
  });

  it('removes wallet instructions once a payment hash is available', () => {
    const { container } = render(<UsdcWalletStatus {...props} hasTxHash />);
    expect(container.textContent).toBe('');
  });
});
