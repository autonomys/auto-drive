import { useCallback, useMemo } from 'react';
import { useNetwork } from '../contexts/network';
import {
  paymentReceiverContractsByNetworkId,
  paymentIntentAbi,
  evmChains,
} from '@auto-drive/ui';
import { Address, Chain, Hash } from 'viem';

export interface PaymentIntentTransaction {
  abi: typeof paymentIntentAbi;
  functionName: 'paymentIntent';
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

  const paymentIntent = useCallback(
    async (amount: bigint) => {
      console.log('Creating intent');
      const intentId: string = await api.createIntent();

      return {
        abi: paymentIntentAbi,
        functionName: 'paymentIntent',
        args: [intentId as Hash],
        value: amount,
        address: targetContract,
        intentId,
        chain: evmChains[network.id],
      } as PaymentIntentTransaction;
    },
    [api, network.id, targetContract],
  );

  return { paymentIntent, targetContract };
};
