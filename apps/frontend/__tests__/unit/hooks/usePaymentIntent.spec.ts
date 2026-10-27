/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react';
import { NetworkId, paymentReceiverContractsByNetworkId } from '@auto-drive/ui';
import { usePaymentIntent } from '../../../src/hooks/usePaymentIntent';

let networkId = NetworkId.MAINNET;
const createIntent = jest.fn<() => Promise<{ id: string }>>();
const api = { createIntent };

jest.mock('../../../src/contexts/network', () => ({
  useNetwork: () => ({ network: { id: networkId }, api }),
}));

describe('AI3 payment intent network', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createIntent.mockResolvedValue({ id: `0x${'ab'.repeat(32)}` });
  });

  it.each([
    [NetworkId.MAINNET, 870],
    [NetworkId.LOCAL, 8700],
  ] as const)('uses wagmi chainId for %s', async (network, chainId) => {
    networkId = network;
    const { result } = renderHook(() => usePaymentIntent());
    const transaction = await result.current.paymentIntent(100n, 1024n);

    expect(transaction).toMatchObject({
      chainId,
      address: paymentReceiverContractsByNetworkId[network],
      functionName: 'payIntent',
      value: 100n,
    });
    expect(transaction).not.toHaveProperty('chain');
    expect(createIntent).toHaveBeenCalledWith({ requestedBytes: 1024n });
  });
});
