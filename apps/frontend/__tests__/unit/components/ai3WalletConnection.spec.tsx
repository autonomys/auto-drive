/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { PurchaseStep3TransferTokens } from '../../../src/components/views/PurchaseCredits/steps/Step3_TransferTokens';

let isConnected = true;
let isDisconnecting = false;
let disconnectError: Error | null = null;
const connector = { name: 'MetaMask', uid: 'metamask' };
const disconnect = jest.fn(() => {
  isConnected = false;
});
const openConnectModal = jest.fn();
const paymentIntent = jest.fn<() => Promise<{ intentId: string }>>();
const writeContractAsync = jest.fn<() => Promise<string>>();
const useTransactionConfirmation = jest.fn<
  (options: unknown) => Record<string, never>
>(() => ({}));
const api = {};

jest.mock('@auto-drive/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  cn: (...values: string[]) => values.filter(Boolean).join(' '),
}));
jest.mock('wagmi', () => ({
  useAccount: () => ({
    address: isConnected ? '0xpayer' : undefined,
    connector: isConnected ? connector : undefined,
    isConnected,
  }),
  useDisconnect: () => ({
    disconnect,
    isPending: isDisconnecting,
    error: disconnectError,
  }),
  usePublicClient: () => undefined,
  useWriteContract: () => ({ writeContractAsync, isPending: false }),
}));
jest.mock('@rainbow-me/rainbowkit', () => ({
  useConnectModal: () => ({ openConnectModal }),
}));
jest.mock('../../../src/contexts/network', () => ({
  useNetwork: () => ({ api }),
}));
jest.mock('../../../src/hooks/usePaymentIntent', () => ({
  usePaymentIntent: () => ({ paymentIntent, MINIMUM_CONFIRMATIONS: 6 }),
}));
jest.mock('../../../src/hooks/usePrices', () => ({
  usePrices: () => ({
    formatCreditsInMbAsValue: () => 1n,
    formatCreditsInMbAsAi3: () => 1,
  }),
}));
jest.mock('../../../src/hooks/useTransactionConfirmation', () => ({
  useTransactionConfirmation: (options: unknown) =>
    useTransactionConfirmation(options),
}));
jest.mock(
  '../../../src/components/views/PurchaseCredits/steps/UsdcTransferPanel',
  () => ({
    UsdcTransferPanel: () => null,
  }),
);

const panel = () => (
  <PurchaseStep3TransferTokens
    onNext={jest.fn()}
    onBack={jest.fn()}
    context={{ sizeMB: 1024 }}
  />
);

describe('AI3 payment wallet controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isConnected = true;
    isDisconnecting = false;
    disconnectError = null;
    paymentIntent.mockResolvedValue({ intentId: 'intent' });
    writeContractAsync.mockResolvedValue('0xpayment');
  });

  it('disconnects the displayed provider and offers the wallet picker again', () => {
    const { rerender } = render(panel());
    expect(screen.getByText('MetaMask')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Wallet' }));
    expect(disconnect).toHaveBeenCalledWith({ connector });
    rerender(panel());
    expect(screen.queryByText('0xpayer')).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Send Transfer',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
    expect(openConnectModal).toHaveBeenCalledTimes(1);
  });

  it('blocks disconnect during payment preparation and preserves a submitted payment', async () => {
    let resolveIntent!: (value: { intentId: string }) => void;
    paymentIntent.mockReturnValue(
      new Promise((resolve) => {
        resolveIntent = resolve;
      }),
    );
    const { rerender } = render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Send Transfer' }));
    const button = screen.getByRole('button', {
      name: 'Disconnect Wallet',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(disconnect).not.toHaveBeenCalled();
    await act(async () => {
      resolveIntent({ intentId: 'intent' });
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    rerender(panel());
    expect(screen.getByText('0xpayment')).toBeTruthy();
    expect(useTransactionConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({ txHash: '0xpayment', intentId: 'intent' }),
    );
  });

  it('disables repeated disconnects while the provider is disconnecting', () => {
    isDisconnecting = true;
    render(panel());
    const button = screen.getByRole('button', {
      name: 'Disconnecting…',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('keeps disconnect available after a provider error', () => {
    disconnectError = new Error('Provider failed');
    render(panel());
    expect(screen.getByRole('alert').textContent).toMatch(
      /Could not disconnect/,
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Disconnect Wallet',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
