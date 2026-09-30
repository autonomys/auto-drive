/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { PurchaseStep3TransferTokens } from '../../../src/components/views/PurchaseCredits/steps/Step3_TransferTokens';

let isConnected = true;
let isDisconnecting = false;
let disconnectError: Error | null = null;
let networkId = 'mainnet';
let connectedChainId = 870;
const connector = { name: 'MetaMask', uid: 'metamask' };
const disconnect = jest.fn(() => {
  isConnected = false;
});
const openConnectModal = jest.fn();
const onBack = jest.fn();
const paymentIntent = jest.fn<() => Promise<{ intentId: string }>>();
const writeContractAsync = jest.fn<() => Promise<string>>();
const switchChainAsync =
  jest.fn<(options: { chainId: number }) => Promise<unknown>>();
const getGasPrice = jest.fn<() => Promise<bigint>>();
const publicClient = { getGasPrice };
const usePublicClient = jest.fn<(options: unknown) => typeof publicClient>(
  () => publicClient,
);
const useTransactionConfirmation = jest.fn<
  (options: unknown) => Record<string, never>
>(() => ({}));
const api = {};

jest.mock('@auto-drive/ui', () => ({
  ...jest.requireActual<typeof import('@auto-drive/ui')>('@auto-drive/ui'),
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
    chainId: connectedChainId,
  }),
  useDisconnect: () => ({
    disconnect,
    isPending: isDisconnecting,
    error: disconnectError,
  }),
  usePublicClient: (options: unknown) => usePublicClient(options),
  useSwitchChain: () => ({ switchChainAsync, isPending: false }),
  useWriteContract: () => ({ writeContractAsync, isPending: false }),
}));
jest.mock('@rainbow-me/rainbowkit', () => ({
  useConnectModal: () => ({ openConnectModal }),
}));
jest.mock('../../../src/contexts/network', () => ({
  useNetwork: () => ({ api, network: { id: networkId } }),
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
    onBack={onBack}
    context={{ sizeMB: 1024 }}
  />
);

describe('AI3 payment wallet controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isConnected = true;
    isDisconnecting = false;
    disconnectError = null;
    networkId = 'mainnet';
    connectedChainId = 870;
    getGasPrice.mockResolvedValue(2_000_000_000n);
    switchChainAsync.mockImplementation(async ({ chainId }) => {
      connectedChainId = chainId;
      return { id: chainId };
    });
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

  it.each([true, false])(
    'allows Back before payment (connected=%s)',
    (connected) => {
      isConnected = connected;
      render(panel());
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(paymentIntent).not.toHaveBeenCalled();
    },
  );

  it.each(['preparation', 'wallet'] as const)(
    'allows Back after a failed %s request, but not while it is pending',
    async (stage) => {
      let rejectRequest!: (error: Error) => void;
      const request =
        stage === 'preparation' ? paymentIntent : writeContractAsync;
      request.mockImplementationOnce(
        () =>
          new Promise<never>((_, reject) => {
            rejectRequest = reject;
          }),
      );
      const errorLog = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      try {
        render(panel());
        fireEvent.click(screen.getByRole('button', { name: 'Send Transfer' }));
        await waitFor(() => expect(request).toHaveBeenCalled());
        const back = screen.getByRole('button', {
          name: 'Back',
        }) as HTMLButtonElement;
        expect(back.disabled).toBe(true);
        fireEvent.click(back);
        expect(onBack).not.toHaveBeenCalled();
        await act(async () => {
          rejectRequest(new Error('Request rejected'));
        });
        expect(screen.getByRole('alert').textContent).toBe('Request rejected');
        expect(back.disabled).toBe(false);
        fireEvent.click(back);
        expect(onBack).toHaveBeenCalledTimes(1);
      } finally {
        errorLog.mockRestore();
      }
    },
  );

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
    connectedChainId = 11155111;
    rerender(panel());
    expect(screen.getByText('0xpayment')).toBeTruthy();
    const back = screen.getByRole('button', {
      name: 'Back',
    }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    fireEvent.click(back);
    expect(onBack).not.toHaveBeenCalled();
    expect(useTransactionConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        txHash: '0xpayment',
        intentId: 'intent',
        chainId: 870,
      }),
    );
  });

  it.each([
    ['mainnet', 870],
    ['local', 8700],
  ])(
    'switches from Sepolia to the %s AI3 network before requesting payment',
    async (network, chainId) => {
      networkId = network as string;
      connectedChainId = 11155111;
      let resolveSwitch!: (value: unknown) => void;
      switchChainAsync.mockReturnValue(
        new Promise((resolve) => {
          resolveSwitch = resolve;
        }),
      );
      render(panel());
      expect(screen.getByText(/will switch to Auto EVM/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Send Transfer' }));
      expect(switchChainAsync).toHaveBeenCalledWith({ chainId, connector });
      expect(paymentIntent).not.toHaveBeenCalled();
      expect(writeContractAsync).not.toHaveBeenCalled();
      const back = screen.getByRole('button', {
        name: 'Back',
      }) as HTMLButtonElement;
      expect(back.disabled).toBe(true);
      fireEvent.click(back);
      expect(onBack).not.toHaveBeenCalled();
      await act(async () => {
        resolveSwitch({ id: chainId });
      });
      expect(writeContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId,
          account: '0xpayer',
          connector,
          gasPrice: 3_000_000_000n,
        }),
      );
      expect(usePublicClient).toHaveBeenLastCalledWith({ chainId });
      expect(useTransactionConfirmation).toHaveBeenLastCalledWith(
        expect.objectContaining({ chainId }),
      );
    },
  );

  it('does not create an intent or send payment if the network switch is rejected', async () => {
    connectedChainId = 11155111;
    switchChainAsync.mockRejectedValue(new Error('Network switch rejected'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(panel());
      fireEvent.click(screen.getByRole('button', { name: 'Send Transfer' }));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe(
          'Network switch rejected',
        ),
      );
      expect(paymentIntent).not.toHaveBeenCalled();
      expect(getGasPrice).not.toHaveBeenCalled();
      expect(writeContractAsync).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(
        (
          screen.getByRole('button', {
            name: 'Send Transfer',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('sends on Auto EVM without a switch when already connected to it', async () => {
    render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Send Transfer' }));
    await waitFor(() => expect(writeContractAsync).toHaveBeenCalled());
    expect(switchChainAsync).not.toHaveBeenCalled();
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 870 }),
    );
  });

  it('keeps the write pinned if the wallet network changes during preparation', async () => {
    let resolveIntent!: (value: { intentId: string }) => void;
    paymentIntent.mockReturnValue(
      new Promise((resolve) => {
        resolveIntent = resolve;
      }),
    );
    const { rerender } = render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Send Transfer' }));
    connectedChainId = 11155111;
    rerender(panel());
    await act(async () => {
      resolveIntent({ intentId: 'intent' });
    });
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 870 }),
    );
    expect(usePublicClient).toHaveBeenLastCalledWith({ chainId: 870 });
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
