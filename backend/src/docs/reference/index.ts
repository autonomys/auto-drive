import { common } from './common.js'
import { downloads } from './downloads.js'
import { objects } from './objects.js'
import { subscriptions } from './subscriptions.js'
import { uploads } from './uploads.js'

export const swagger = {
  openapi: '3.0.0',
  info: {
    title: 'Auto Drive API',
    version: '1.0.0',
    description: 'API for Auto Drive',
  },
  servers: [
    {
      url: 'https://mainnet.auto-drive.autonomys.xyz/api',
      description: 'Mainnet',
    },
    {
      url: 'https://demo.auto-drive.autonomys.xyz/api',
      description: 'Testnet',
    },
  ],
  paths: {
    ...subscriptions.paths,
    ...uploads.paths,
    ...objects.paths,
    ...downloads.paths,
  },
  security: [
    {
      apiKey: [],
      provider: [],
    },
  ],
  components: {
    schemas: {
      ...uploads.components.schemas,
      ...objects.components.schemas,
      ...common.components.schemas,
      ...subscriptions.components.schemas,
      ...downloads.components.schemas,
    },
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description:
          'Bearer token for authentication. Example: Bearer <token>. Could be either an API key or a JWT token.',
      },
      provider: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Auth-Provider',
        description:
          'Used for differentiating between different auth providers. For most use cases: X-Auth-Provider: apikey',
      },
    },
  },
}
