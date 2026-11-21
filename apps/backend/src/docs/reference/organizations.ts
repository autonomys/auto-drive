import { autoDriveServers } from './servers.js'

const organizationIdParameter = {
  name: 'organizationId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
}

// Fields every API key response carries.
const apiKeyProperties = {
  id: { type: 'string' },
  name: { type: 'string', nullable: true },
  scopes: {
    type: 'array',
    items: { $ref: '#/components/schemas/ApiKeyScope' },
    nullable: true,
    description: 'What the key may be used for. Null for full access.',
  },
  expiresAt: { type: 'string', format: 'date-time', nullable: true },
  createdAt: { type: 'string', format: 'date-time', nullable: true },
}

export const organizations = {
  paths: {
    '/organizations/{organizationId}/api-keys': {
      get: {
        summary: 'Organizations - List the API keys of an organization',
        description:
          'For members of the organization and Auto Drive admins, signed in. API keys cannot manage API keys.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [organizationIdParameter],
        responses: {
          '200': {
            description:
              'The keys, and whether the caller may create and revoke them',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    apiKeys: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          ...apiKeyProperties,
                          maskedSecret: { type: 'string' },
                        },
                      },
                    },
                    canCreate: { type: 'boolean' },
                    canRevoke: { type: 'boolean' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Not a member, or an API key' },
          '404': { description: 'Not a partner organization' },
        },
      },
      post: {
        summary: 'Organizations - Create an API key',
        description:
          'For organization admins, signed in. Returns the secret, which is never shown again. Without `scopes` the key has full access.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [organizationIdParameter],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', maxLength: 64, nullable: true },
                  expiresAt: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                  },
                  scopes: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/ApiKeyScope' },
                    minItems: 1,
                    uniqueItems: true,
                    nullable: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'The key with its secret',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ...apiKeyProperties,
                    secret: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid name, expiry or scopes' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Not an organization admin, or an API key' },
          '404': { description: 'Not a partner organization' },
          '409': { description: 'The organization is archived' },
        },
      },
    },
  },
  components: {
    schemas: {
      ApiKeyScope: {
        type: 'string',
        enum: ['files', 'end_users', 'usage'],
        description:
          '`files`: /uploads, /objects, /downloads and /s3. `usage`: the usage report routes. `end_users`: no routes yet.',
      },
    },
  },
}
