export const depositEventAbi = [
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
