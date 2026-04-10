import { autoDriveServers } from './servers.js'

export const intents = {
  paths: {
    '/intents/price': {
      get: {
        summary: 'Intents - Get current storage price',
        description:
          'Returns the current price per byte (in shannons) and price per GB (in AI3). This endpoint does not require authentication.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        security: [],
        responses: {
          '200': {
            description: 'Current price information',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    price: {
                      type: 'number',
                      description: 'Price per byte in shannons',
                    },
                    pricePerGB: {
                      type: 'number',
                      description: 'Price per GB in AI3 tokens',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/intents/contract': {
      get: {
        summary: 'Intents - Get smart contract info',
        description:
          'Returns the on-chain contract address, EVM chain ID, and the minimal ABI needed to call `payIntent`. This endpoint does not require authentication. Use this to build the on-chain transaction for step 4 of the integration flow.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        security: [],
        responses: {
          '200': {
            description: 'Contract information',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ContractInfo',
                },
              },
            },
          },
        },
      },
    },
    '/intents': {
      post: {
        summary: 'Intents - Create a purchase intent',
        description: `Creates a PENDING intent with the current price locked in. The intent has a time-limited price-lock window (default 10 minutes) during which the price is guaranteed.

**Authentication:** Currently requires a Google-verified account. You can authenticate via:
- Google OAuth session
- API key from a Google-registered account (set \`X-Auth-Provider: apikey\`)

**Third-party integration pattern:**
1. Create an Auto Drive account via Google OAuth at https://ai3.storage
2. Generate an API key from the dashboard
3. Call \`GET /intents/contract\` to get the contract address, chain ID, and ABI
4. Call \`GET /intents/price\` to get the current price per byte and per GB
5. Call \`POST /intents\` with the API key to get an \`intentId\` with the price locked in
6. Have the end user call \`payIntent(intentId)\` on the contract, sending AI3 as native value
7. Call \`POST /intents/:id/watch\` with the transaction hash
8. Poll \`GET /intents/:id\` until status is \`completed\`
9. Upload content via the Auto Drive SDK using the same API key`,
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        responses: {
          '200': {
            description: 'Intent created successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Intent',
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized — missing or invalid credentials',
          },
          '403': {
            description:
              'Google-verified account required — the authenticated account was not registered via Google OAuth',
          },
          '404': {
            description:
              'Feature not available — the buyCredits feature flag is not active for this user',
          },
        },
      },
    },
    '/intents/{id}': {
      get: {
        summary: 'Intents - Get intent status',
        description:
          'Returns the current status of a purchase intent. Use this to poll for completion after calling `/intents/:id/watch`.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The intent ID returned by POST /intents',
          },
        ],
        responses: {
          '200': {
            description: 'Intent details',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Intent',
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
          },
          '403': {
            description:
              'Forbidden — the intent belongs to a different user',
          },
          '404': {
            description: 'Intent not found',
          },
          '410': {
            description: 'Intent has expired (price-lock window elapsed)',
          },
        },
      },
    },
    '/intents/{id}/watch': {
      post: {
        summary: 'Intents - Submit transaction hash for watching',
        description:
          'Attaches a transaction hash to a pending intent and queues on-chain confirmation watching. Call this after the user has submitted the `payIntent` transaction on-chain.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The intent ID',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  txHash: {
                    type: 'string',
                    description:
                      'The transaction hash from the on-chain payIntent call',
                  },
                },
                required: ['txHash'],
              },
            },
          },
        },
        responses: {
          '204': {
            description: 'Transaction hash accepted — watching started',
          },
          '400': {
            description: 'Missing or invalid txHash',
          },
          '401': {
            description: 'Unauthorized',
          },
          '403': {
            description: 'Forbidden — the intent belongs to a different user',
          },
          '410': {
            description: 'Intent has expired',
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ContractInfo: {
        type: 'object',
        required: ['chainId', 'contractAddress', 'payIntentAbi'],
        properties: {
          chainId: {
            type: 'integer',
            description:
              'EVM chain ID where the contract is deployed (e.g. 870 for Auto-EVM Mainnet)',
          },
          contractAddress: {
            type: 'string',
            description:
              'Address of the AutoDriveCreditsReceiver contract (checksummed)',
          },
          payIntentAbi: {
            type: 'array',
            description:
              'Minimal ABI for the payIntent function — pass directly to viem/ethers/web3.js',
            items: { type: 'object' },
          },
        },
      },
      Intent: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique intent identifier (hex string)',
          },
          userPublicId: {
            type: 'string',
            description: 'Public ID of the intent owner',
          },
          status: {
            type: 'string',
            enum: [
              'pending',
              'confirmed',
              'completed',
              'failed',
              'expired',
              'over_cap',
            ],
            description: 'Current intent status',
          },
          txHash: {
            type: 'string',
            description: 'On-chain transaction hash (set after /watch)',
          },
          paymentAmount: {
            type: 'string',
            description: 'Payment amount in shannons (bigint as string)',
          },
          shannonsPerByte: {
            type: 'string',
            description:
              'Locked price per byte in shannons (bigint as string)',
          },
          expiresAt: {
            type: 'string',
            format: 'date-time',
            description: 'Price-lock expiry timestamp',
          },
        },
      },
    },
  },
}
