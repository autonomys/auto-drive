export const depositEventAbi = [
  {
    type: 'event',
    name: 'Deposit',
    anonymous: false,
    inputs: [
      { name: 'intentId', type: 'bytes32', indexed: true },
      { name: 'depositAmount', type: 'uint256', indexed: false },
    ],
  },
] as const
