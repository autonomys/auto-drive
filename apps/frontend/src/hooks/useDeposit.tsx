import { useCallback, useMemo } from 'react';
import { useNetwork } from '../contexts/network';
import {
  depositAbi,
  depositContractsByNetworkId,
  evmChains,
} from '@auto-drive/ui';
import { Address, Chain, Hash } from 'viem';

export interface DepositTransaction {
  abi: typeof depositAbi;
  functionName: 'deposit';
  args: [Hash];
  value: bigint;
  address: Address;
  intentId: string;
  chain: Chain;
}

export const useDeposit = () => {
  const { network, api } = useNetwork();

  const targetContract = useMemo(
    () => depositContractsByNetworkId[network.id],
    [network.id],
  );

  const deposit = useCallback(
    async (amount: bigint) => {
      console.log('Creating intent');
      const intentId: string = await api.createIntent();

      return {
        abi: depositAbi,
        functionName: 'deposit',
        args: [intentId as Hash],
        value: amount,
        address: targetContract,
        intentId,
        chain: evmChains[network.id],
      } as DepositTransaction;
    },
    [api, network.id, targetContract],
  );

  return { deposit, targetContract };
};
