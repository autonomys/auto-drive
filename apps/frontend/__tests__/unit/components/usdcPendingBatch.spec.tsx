/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { UsdcTransferPanel } from '../../../src/components/views/PurchaseCredits/steps/UsdcTransferPanel';
import { saveUsdcResume } from '../../../src/utils/usdcResume';

const pending = {
  intentId: 'intent',
  batchId: 'batch',
  payer: '0xpayer',
  chainId: 1,
  sizeMib: 1024,
};
let batch: typeof pending | null = pending;
let hasKnownPayment = false;
let isPaymentCompleted = false;
let hasQuote = false;
const onBack = jest.fn();
const quote = jest.fn();
const api = { watchIntent: jest.fn() };

jest.mock('@auto-drive/ui', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  cn: (...values: string[]) => values.filter(Boolean).join(' '),
}));
jest.mock('wagmi', () => ({
  useAccount: () => ({ address: '0xpayer', isConnected: true, chainId: 1 }),
}));
jest.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
jest.mock('../../../src/contexts/network', () => ({
  useNetwork: () => ({ api }),
}));
jest.mock('../../../src/hooks/useUsdcAvailability', () => ({
  useUsdcAvailability: () => ({
    target: { chainId: 1 },
    chain: { name: 'Ethereum' },
    isAvailable: false,
    isLoading: false,
    isUnsupported: false,
  }),
}));
jest.mock('../../../src/hooks/useUsdcPurchase', () => ({
  QUOTE_MIN_REMAINING_MS: 45_000,
  useUsdcPurchase: () => ({
    stage: batch ? 'batch-pending' : hasQuote ? 'quoted' : 'idle',
    isBusy: false,
    intent: hasQuote
      ? {
          id: 'intent',
          expiresAt: new Date('2099-01-01'),
          quotedTokenAmount: 12_500_000n,
        }
      : null,
    payTxHash: undefined,
    isPaymentCompleted,
    failure: hasKnownPayment ? 'existing-payment' : null,
    message: null,
    approvalSkipped: false,
    mayHaveBroadcast: Boolean(batch || hasKnownPayment),
    batch,
    batchStatusUnavailable: true,
    quote,
    pay: jest.fn(),
    reset: jest.fn(),
    acknowledgeNotBroadcast: jest.fn(),
  }),
}));
jest.mock('../../../src/hooks/useTransactionConfirmation', () => ({
  useTransactionConfirmation: () => ({}),
}));

describe('pending USDC batch navigation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    batch = pending;
    hasKnownPayment = false;
    isPaymentCompleted = false;
    hasQuote = false;
    jest.clearAllMocks();
  });

  it('blocks Back and retry acknowledgement for a server payment without a hash', () => {
    batch = null;
    hasKnownPayment = true;
    render(
      <UsdcTransferPanel
        onNext={jest.fn()}
        onBack={onBack}
        context={{ sizeMB: 1024 }}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Processing payment…',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.queryByRole('button', {
        name: 'My wallet shows nothing was sent',
      }),
    ).toBeNull();
    expect(
      screen.queryByText('Go back to change the payment method.'),
    ).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(
      /already been recorded/,
    );
  });

  it('lets a completed purchase continue without a transaction hash', () => {
    batch = null;
    isPaymentCompleted = true;
    const onNext = jest.fn();
    render(
      <UsdcTransferPanel
        onNext={onNext}
        onBack={onBack}
        context={{ sizeMB: 1024 }}
      />,
    );
    expect(screen.getByText('Your credits have been added.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalledWith({ sizeMB: 1024 });
    expect(
      screen.queryByRole('button', { name: /Pay|Get a price/ }),
    ).toBeNull();
  });

  it.each([false, true])(
    'hides unpaid instructions for a known payment (resumed=%s)',
    (resumed) => {
      batch = null;
      hasKnownPayment = true;
      hasQuote = !resumed;
      if (resumed)
        saveUsdcResume({
          intentId: 'intent',
          paymentKnown: true,
          chainId: 1,
          sizeMib: 1024,
        });
      render(
        <UsdcTransferPanel
          onNext={jest.fn()}
          onBack={onBack}
          context={{ sizeMB: 1024 }}
        />,
      );
      expect(screen.queryByText(/Nothing has been sent yet/)).toBeNull();
      expect(screen.queryByText('Confirm the amount')).toBeNull();
      expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
      expect(
        (
          screen.getByRole('button', {
            name: 'Processing payment…',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(screen.getByRole('status').textContent).toMatch(
        /already been recorded/,
      );
    },
  );

  it('keeps the review instructions and Pay action for an unpaid quote', () => {
    batch = null;
    hasQuote = true;
    render(
      <UsdcTransferPanel
        onNext={jest.fn()}
        onBack={onBack}
        context={{ sizeMB: 1024 }}
      />,
    );
    expect(screen.getByText(/Nothing has been sent yet/)).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: /^Pay .* USDC$/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it.each([false, true])(
    'blocks Back and change-payment links for a pending batch (resumed=%s)',
    (resumed) => {
      if (resumed) saveUsdcResume(pending);
      render(
        <UsdcTransferPanel
          onNext={jest.fn()}
          onBack={onBack}
          context={{ sizeMB: 1024 }}
        />,
      );
      const back = screen.getByRole('button', {
        name: 'Back',
      }) as HTMLButtonElement;
      expect(back.disabled).toBe(true);
      fireEvent.click(back);
      expect(onBack).not.toHaveBeenCalled();
      expect(
        screen.queryByText('Go back to change the payment method.'),
      ).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: 'My wallet shows nothing was sent',
        }),
      ).toBeNull();
    },
  );

  it('allows Back once the wallet has resolved the batch as failed', () => {
    const { rerender } = render(
      <UsdcTransferPanel
        onNext={jest.fn()}
        onBack={onBack}
        context={{ sizeMB: 1024 }}
      />,
    );
    batch = null;
    rerender(
      <UsdcTransferPanel
        onNext={jest.fn()}
        onBack={onBack}
        context={{ sizeMB: 1024 }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
