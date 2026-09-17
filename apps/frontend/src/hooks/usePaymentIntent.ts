import { useCallback, useMemo } from 'react';
import { useNetwork } from '../contexts/network';
import {
  paymentReceiverContractsByNetworkId,
  paymentReceiverAbi,
  evmChains,
} from '@auto-drive/ui';
import { PaymentMethod } from '@auto-drive/models';
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

  const MINIMUM_CONFIRMATIONS = 6;

  const paymentIntent = useCallback(
    async (amount: bigint, requestedBytes?: bigint) => {
      // No paymentMethod: the AI3 path leaves it off the request body entirely,
      // so the backend's own default applies and this call is byte-for-byte the
      // one that has always been made.
      const intent = await api.createIntent({ requestedBytes });

      return {
        abi: paymentReceiverAbi,
        functionName: 'payIntent',
        args: [intent.id as Hash],
        value: amount,
        address: targetContract,
        intentId: intent.id,
        chain: evmChains[network.id],
      } as PaymentIntentTransaction;
    },
    [api, network.id, targetContract],
  );

  /**
   * Create the USDC intent, and return the quote the buyer has to pay.
   *
   * Separate from `paymentIntent` above rather than a branch inside it, because
   * the two return different things and neither is a special case of the other.
   * The AI3 call returns a ready-to-sign transaction whose `value` the CLIENT
   * computed; this one returns an amount the SERVER computed and locked, which
   * the client cannot derive — the oracle rate and the quote margin both live
   * behind the API. Collapsing them would mean a single return type where half
   * the fields are meaningless per branch.
   *
   * The transaction itself is not built here: paying in USDC is two calls to two
   * contracts with a wallet chain-switch in front of them, which is a small state
   * machine rather than a descriptor — see useUsdcPurchase.
   */
  const usdcPaymentIntent = useCallback(
    async (requestedBytes: bigint) =>
      api.createIntent({
        requestedBytes,
        paymentMethod: PaymentMethod.USDC_ETH,
      }),
    [api],
  );

  return {
    paymentIntent,
    usdcPaymentIntent,
    targetContract,
    MINIMUM_CONFIRMATIONS,
  };
};
