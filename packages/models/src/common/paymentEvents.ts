/**
 * On-chain payment event ABIs, shared between the backend payment manager
 * (viem log parsing) and the frontend (event watching / contract reads) so the
 * event signatures can never drift from the deployed receiver contracts.
 */

// AutoDriveCreditsReceiver.payIntent (native AI3 on Auto EVM) emits this.
export const intentPaymentReceivedAbi = [
  {
    type: 'event',
    name: 'IntentPaymentReceived',
    anonymous: false,
    inputs: [
      { name: 'intentId', type: 'bytes32', indexed: true },
      { name: 'paymentAmount', type: 'uint256', indexed: false },
    ],
  },
] as const

// AutoDriveUSDCReceiver.payIntentWithToken (USDC/ERC20 on Ethereum) emits this.
// `payer` is carried in the event rather than read from the tx receipt because
// ERC20 payments can be relayed by a third party. `intentId` and `payer` are
// indexed so logs can be filtered by intent and by paying wallet.
export const intentTokenPaymentReceivedAbi = [
  {
    type: 'event',
    name: 'IntentTokenPaymentReceived',
    anonymous: false,
    inputs: [
      { name: 'intentId', type: 'bytes32', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'payer', type: 'address', indexed: true },
    ],
  },
] as const
