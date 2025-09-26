import { common } from './common.js'
import { downloads } from './downloads.js'
import { objects } from './objects.js'
import { accounts } from './accounts.js'
import { uploads } from './uploads.js'

export const swagger = {
  openapi: '3.0.0',
  info: {
    title: 'Auto Drive APIs',
    version: '1.1.0',
    description: `Auto-Drive consists of multiple APIs that are used to interact with the Auto-Drive platform.

## Authentication

All requests to the Auto-Drive APIs require authentication. The following authentication methods are supported:

- API Key
- JWT Token (rarely used)

## How to use an API key?

The API key is a string that is used to authenticate requests to the Auto-Drive APIs, you can create one in the [Auto-Drive Dashboard](https://ai3.storage).

To use an API key, include it in the Authorization header with the Bearer prefix:

\`\`\`
Authorization: Bearer your-api-key
X-Auth-Provider: apikey
\`\`\`

API keys should be kept secure and not shared with unauthorized parties.

## Auto-Drive Services

Auto-Drive consists of two main services:

### 1. Auto-Drive API

The Storage Service handles all file operations including uploads, downloads, and object management. It provides APIs for:
- File uploads (single and multipart)
- Object metadata management
- Access control and permissions
- Subscription management

### 2. Auto-Drive Download Gateway

The Auto-Drive Download Gateway is a service that allows you to download files from the Auto-Drive API. It provides APIs for:
- File downloads
- Async downloads`,
  },
  paths: {
    ...accounts.paths,
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
      ...accounts.components.schemas,
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
