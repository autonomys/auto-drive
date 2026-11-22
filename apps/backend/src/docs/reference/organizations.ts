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

const endUserSchema = {
  type: 'object',
  properties: {
    address: {
      type: 'string',
      description: 'The EIP-55 checksummed address of the wallet key',
    },
    publicId: { type: 'string' },
    customerReference: { type: 'string' },
    uploadQuotaBytes: {
      type: 'integer',
      nullable: true,
      description: 'Null for the default of the organization',
    },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

const endUsersAccess =
  'For an API key of the organization itself (a key with scopes needs `end_users`) and for its organization admins, signed in.'

export const organizations = {
  paths: {
    '/organizations/{organizationId}/end-users': {
      post: {
        summary: 'Organizations - Enroll end users',
        description: `${endUsersAccess} End users are a partner's customers, each identified by a wallet address. They own the files they upload, which are charged to the organization's account, and are not members of the organization. An address already enrolled with the same customer reference is returned as it is, so a request can be retried; the rest of the request is enrolled. All or none of the end users in a request are enrolled.`,
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [organizationIdParameter],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['endUsers'],
                properties: {
                  endUsers: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 100,
                    items: {
                      type: 'object',
                      required: ['address', 'customerReference'],
                      properties: {
                        address: {
                          type: 'string',
                          description:
                            'A 0x-prefixed Ethereum address, checksummed (EIP-55) or all lower case',
                        },
                        customerReference: {
                          type: 'string',
                          pattern: '^[A-Za-z0-9._:-]{1,128}$',
                          description:
                            'Your own reference for the customer, unique among the end users of the organization. Use a pseudonymous ID, never personal data.',
                        },
                        uploadQuotaBytes: {
                          type: 'integer',
                          minimum: 1,
                          nullable: true,
                          description:
                            'The upload quota of the end user. Omitted for the default of the organization.',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'The end users, in request order',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    endUsers: { type: 'array', items: endUserSchema },
                  },
                },
              },
            },
          },
          '400': {
            description:
              'An invalid body or address, or an address or customer reference given twice',
          },
          '401': { description: 'Unauthorized' },
          '403': {
            description:
              'Not an organization admin or the organization API key, or a key without the end_users scope',
          },
          '404': { description: 'Not a partner organization' },
          '409': {
            description:
              'An address enrolled with another customer reference, a customer reference another end user has, an address with another Auto Drive user, or more end users than the organization may have',
          },
        },
      },
      get: {
        summary: 'Organizations - List end users',
        description: `${endUsersAccess} Auto Drive admins may list them too. Ordered by enrollment.`,
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          organizationIdParameter,
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0, default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'A page of end users, and how many there are',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    endUsers: { type: 'array', items: endUserSchema },
                    totalCount: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid limit or offset' },
          '401': { description: 'Unauthorized' },
          '403': {
            description:
              'Not an organization admin, the organization API key or an Auto Drive admin, or a key without the end_users scope',
          },
          '404': { description: 'Not a partner organization' },
        },
      },
    },
    '/organizations/{organizationId}/end-users/{address}': {
      delete: {
        summary: 'Organizations - Remove an end user',
        description: `${endUsersAccess} Auto Drive admins may remove them too. The end user keeps their files, and is no longer charged to the organization.`,
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          organizationIdParameter,
          {
            name: 'address',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '204': { description: 'Removed' },
          '400': { description: 'Not an address' },
          '401': { description: 'Unauthorized' },
          '403': {
            description:
              'Not an organization admin, the organization API key or an Auto Drive admin, or a key without the end_users scope',
          },
          '404': {
            description:
              'Not a partner organization, or not an end user of the organization',
          },
        },
      },
    },
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
          '`files`: /uploads, /objects, /downloads and /s3. `usage`: the usage report routes. `end_users`: the end user routes of the organization.',
      },
    },
  },
}
