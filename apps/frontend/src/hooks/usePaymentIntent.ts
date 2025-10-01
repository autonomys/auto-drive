import { useCallback, useMemo } from 'react';
import { useNetwork } from '../contexts/network';
import {
  paymentReceiverContractsByNetworkId,
  paymentReceiverAbi,
  evmChains,
} from '@auto-drive/ui';
import { Address, Chain, Hash } from 'viem';

export interface PaymentIntentTransaction {
  abi: typeof paymentReceiverAbi;
  functionName: 'payIntent';
  args: [Hash];
  value: bigint;
  address: Address;
  intentId: string;
  chain: Chain;
}

export const usePaymentIntent = () => {
  const { network, api } = useNetwork();

  const targetContract = useMemo(
    () => paymentReceiverContractsByNetworkId[network.id],
    [network.id],
  );

  const MINIMUM_CONFIRMATIONS = 12;

  const paymentIntent = useCallback(
    async (amount: bigint) => {
      const intentId: string = await api.createIntent();

      return {
        abi: paymentReceiverAbi,
        functionName: 'payIntent',
        args: [intentId as Hash],
        value: amount,
        address: targetContract,
        intentId,
        chain: evmChains[network.id],
      } as PaymentIntentTransaction;
    },
    [api, network.id, targetContract],
  );

  return { paymentIntent, targetContract, MINIMUM_CONFIRMATIONS };
};
