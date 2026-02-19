import { autoDriveServers } from './servers.js'

const publicServers = [
  {
    url: 'https://public.auto-drive.autonomys.xyz/api',
    description: 'Public Auto Drive Gateway (Mainnet)',
  },
  ...autoDriveServers,
]

export const price = {
  paths: {
    '/intents/price': {
      get: {
        summary: 'Price - Get current storage price estimation',
        description: `Returns the current cost of storage in shannons per byte.

This is a **public endpoint** — no authentication or feature flags required.

### Caching

Responses include \`Cache-Control: public, max-age=30\`.  The underlying chain
price is refreshed at most once every 60 seconds server-side.

### Price calculation

\`\`\`
price = transactionByteFee × priceMultiplier
\`\`\`

Where:
- \`transactionByteFee\` is the current fee per byte from the Autonomys consensus chain
- \`priceMultiplier\` is a server-side configurable multiplier

To convert to AI3 per MiB: \`(price × 1048576) / 10^18\``,
        tags: ['Auto Drive API'],
        servers: publicServers,
        security: [],
        responses: {
          '200': {
            description: 'Successfully retrieved current storage price',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PriceResponse',
                },
              },
            },
            headers: {
              'Cache-Control': {
                description:
                  'Caching directive — typically `public, max-age=30`',
                schema: { type: 'string' },
              },
            },
          },
          '500': {
            description: 'Failed to get price',
          },
        },
      },
    },
  },
  components: {
    schemas: {
      PriceResponse: {
        type: 'object',
        properties: {
          price: {
            type: 'number',
            description:
              'Current storage price in shannons per byte (1 AI3 = 10^18 shannons)',
            example: 500000000,
          },
        },
        required: ['price'],
      },
    },
  },
}
