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
  isBusy: false,
  mayHaveBroadcast: true,
  hasTxHash: false,
  hasBatch: false,
  batchStatusUnavailable: false,
  batchWalletConnected: true,
  onAcknowledge: jest.fn(),
};

describe('USDC wallet progress', () => {
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
