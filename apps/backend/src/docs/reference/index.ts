import { common } from './common.js'
import { downloads } from './downloads.js'
import { objects } from './objects.js'
import { accounts } from './accounts.js'
import { uploads } from './uploads.js'
import { intents } from './intents.js'
import { organizations } from './organizations.js'

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

## API key scopes

An organization API key can be limited to scopes when it is created (\`POST /organizations/{organizationId}/api-keys\`). A key with scopes can be used only on the routes of its scopes; every other route that needs authentication answers it with 403. A key without scopes, and every personal key, has full access.

| Scope | Routes |
| --- | --- |
| \`files\` | \`/uploads\`, \`/objects\`, \`/downloads\` and \`/s3\`: everything the Auto Drive SDK needs to upload, download and list files |
| \`usage\` | \`GET /accounts/@me\` (the account's ID and figures), \`GET /accounts/{accountId}/usage-report\` and \`GET /accounts/{accountId}/usage-report/interactions\` |
| \`end_user_enrollment\` | \`POST\` and \`GET /organizations/{organizationId}/end-users\` and \`PATCH /organizations/{organizationId}/end-users/{address}\`: enroll and list the organization's end users and change their quotas |
| \`end_user_removal\` | \`GET /organizations/{organizationId}/end-users\` and \`DELETE /organizations/{organizationId}/end-users/{address}\`: list and remove them. Keep it off the key your backend uses day to day, so a leak of that key can't remove anyone. |

## Partner end users

A partner end user's session can be used only on the routes below. Every other route that needs authentication answers it with 403, and public routes answer it as an anonymous caller. The S3 API takes only API keys, which end users can't create.

| Routes | Removed end users |
| --- | --- |
| \`/uploads\` | No |
| \`GET /objects/roots\` (always the end user's own objects, whatever \`scope\` asks for), \`GET /objects/roots/deleted\`, \`GET /objects/{cid}\`, \`GET /objects/{cid}/summary\`, \`POST /objects/{cid}/delete\` and \`POST /objects/{cid}/restore\` | Yes |
| \`GET /downloads/{cid}\` and the async downloads under \`/downloads/async\` | Yes |

Each acts only on what the end user owns: an upload they created, or an object they have an ownership row for (their own, shared with them or in their trash), directly or through a root object that contains it. Anything else answers 403, except \`GET /objects/{cid}\` and its summary, which answer as for an anonymous caller.

Every upload an end user makes is recorded under the customer reference they were enrolled with, whatever \`X-Customer-Reference\` says, so the usage report shows one row per person. Each end user has a total upload quota with no time frame: their own if you set one, otherwise the organization's per-person maximum, and never more than that maximum. Removing a file doesn't give quota back. An upload that would pass it answers 402 with the quota in the message: a new upload once nothing is left, and completing one that is too large. Your organization's admins set the maximum, signed in (\`PUT /organizations/{organizationId}/max-end-user-quota\`); it is 0 until they do, so no end user can upload before then.

## Purchasing Storage Credits (Pay with AI3)

Third-party applications can purchase storage credits programmatically using the Intents API. The flow is:

1. **Create an account** — Register at [ai3.storage](https://ai3.storage) via Google OAuth
2. **Generate an API key** — From the dashboard, create an API key
3. **Get contract info** — \`GET /intents/contract\` returns the contract address, chain ID, and ABI
4. **Check current price** — \`GET /intents/price\` returns the current price per byte and per GB to display to the user
5. **Create an intent** — \`POST /intents\` with your API key returns an \`intentId\` with the price locked in
6. **Pay on-chain** — Call \`payIntent(intentId)\` on the contract, sending AI3 as native value
7. **Submit tx hash** — \`POST /intents/:id/watch\` with the transaction hash
8. **Poll for completion** — \`GET /intents/:id\` until status is \`completed\`
9. **Upload content** — Use the Auto Drive SDK with the same API key (credits are now on the account)

**Note:** A Google-verified account is currently required to purchase credits. API keys inherit the auth provider of the account that created them, so an API key from a Google-registered account satisfies this requirement.

## Auto-Drive Services

Auto-Drive consists of two main services:

### 1. Auto-Drive API

The Storage Service handles all file operations including uploads, downloads, and object management. It provides APIs for:
- File uploads (single and multipart)
- Object metadata management
- Access control and permissions
- Account management
- Credit purchases (Pay with AI3)

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
    ...intents.paths,
    ...organizations.paths,
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
      ...intents.components.schemas,
      ...organizations.components.schemas,
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
