/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { PurchaseStep4Success } from '../../../src/components/views/PurchaseCredits/steps/Step4_Success';

type Receipt = {
  paymentMethod?: string;
  paymentAmount?: string;
  tokenAmount?: string;
  quotedTokenAmount?: string;
  txHash?: string;
};
const getIntent = jest.fn<(id: string) => Promise<Receipt>>();
const api = { getIntent };
jest.mock('../../../src/contexts/network', () => ({
  useNetwork: () => ({ api, network: { id: 'mainnet' } }),
}));
jest.mock('../../../src/globalStates/user', () => ({
  useUserStore: () => null,
}));
jest.mock('@auto-drive/ui', () => ({
  ...jest.requireActual<typeof import('@auto-drive/ui')>('@auto-drive/ui'),
  Button: ({ children, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick}>{children}</button>
  ),
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  cn: (...values: string[]) => values.filter(Boolean).join(' '),
}));

const renderReceipt = (context: Record<string, unknown> = {}) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <PurchaseStep4Success
        context={{ sizeMB: 1024, intentId: 'paid-intent', ...context }}
      />
    </QueryClientProvider>,
  );

describe('payment receipt amounts', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('shows actual USDC received with all six decimals, rather than AI3 or the quote', async () => {
    getIntent.mockResolvedValue({
      paymentMethod: 'usdc_eth',
      tokenAmount: '12505001',
      quotedTokenAmount: '12500000',
    });
    renderReceipt({ paymentMethod: 'ai3_native' });
    expect(await screen.findByText('12.505001 USDC')).toBeTruthy();
    expect(screen.getByText('USDC Paid')).toBeTruthy();
    expect(screen.queryByText('AI3 Paid')).toBeNull();
    expect(screen.queryByText('12.50 USDC')).toBeNull();
    expect(getIntent).toHaveBeenCalledWith('paid-intent');
  });

  it('shows the recorded AI3 payment without recalculating from storage prices', async () => {
    getIntent.mockResolvedValue({
      paymentMethod: 'ai3_native',
      paymentAmount: '4854780123456789012345',
    });
    renderReceipt({ paymentMethod: 'usdc_eth' });
    expect(await screen.findByText('4854.780123456789012345 AI3')).toBeTruthy();
    expect(screen.getByText('AI3 Paid')).toBeTruthy();
    expect(screen.queryByText('USDC Paid')).toBeNull();
  });

  it('can load the receipt again from the intent ID after a reload', async () => {
    getIntent.mockResolvedValue({
      paymentMethod: 'usdc_eth',
      tokenAmount: '1000000',
      txHash: '0xreceipt',
    });
    const first = renderReceipt({ paymentMethod: 'usdc_eth' });
    await screen.findByText('1.00 USDC');
    first.unmount();
    renderReceipt({ paymentMethod: 'usdc_eth' });
    expect(await screen.findByText('1.00 USDC')).toBeTruthy();
    expect(screen.getByText('0xreceipt')).toBeTruthy();
    expect(getIntent).toHaveBeenCalledTimes(2);
  });

  it('keeps the correct currency while loading and allows retry after an error', async () => {
    getIntent.mockRejectedValueOnce(new Error('Offline'));
    renderReceipt({ paymentMethod: 'usdc_eth' });
    expect(screen.getByText('USDC Paid')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('USDC Paid').parentElement?.textContent).toContain(
      'Unavailable',
    );
    getIntent.mockResolvedValue({
      paymentMethod: 'usdc_eth',
      tokenAmount: '12500000',
    });
    fireEvent.click(retry);
    expect(await screen.findByText('12.50 USDC')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull(),
    );
  });

  it('does not invent an amount for an old receipt without an intent ID', () => {
    renderReceipt({ intentId: undefined, paymentMethod: 'usdc_eth' });
    expect(screen.getByText('USDC Paid')).toBeTruthy();
    expect(screen.queryByText('AI3 Paid')).toBeNull();
    expect(getIntent).not.toHaveBeenCalled();
  });

  it('does not substitute a quote for an absent settled amount', async () => {
    getIntent.mockResolvedValue({
      paymentMethod: 'usdc_eth',
      quotedTokenAmount: '12500000',
    });
    renderReceipt({ paymentMethod: 'usdc_eth' });
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.queryByText('12.50 USDC')).toBeNull();
  });
});
