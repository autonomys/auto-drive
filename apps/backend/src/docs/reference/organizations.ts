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
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'When the end user was first enrolled',
    },
    removedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description:
        'When the end user was removed. Null unless they are removed now.',
    },
  },
}

const endUsersAccess = (scopes: string) =>
  `For an API key of the organization itself (a key with scopes needs ${scopes}) and for its organization admins, signed in.`

// A refused enrollment never says whether an address has an Auto Drive user.
const enrollmentConflict =
  'An entry conflicts with an existing user or end user: an address with another Auto Drive user or enrolled with another customer reference, a customer reference another end user has (removed or not), or another quota for an end user who is not removed. The message names neither the entry nor the reason. Also: more end users that are not removed than the organization may have, or an archived organization.'

const partnerOriginSchema = {
  type: 'object',
  properties: {
    origin: { type: 'string', example: 'https://app.example.com' },
    organizationId: { type: 'string' },
    createdBy: {
      type: 'string',
      description: 'Public ID of the Auto Drive admin who added it',
    },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

const originParameter = {
  name: 'origin',
  in: 'query',
  required: true,
  description: 'The origin',
  schema: { type: 'string' },
}

export const organizations = {
  paths: {
    '/organizations/{organizationId}/end-users': {
      post: {
        summary: 'Organizations - Enroll end users',
        description: `${endUsersAccess('`end_user_enrollment`')} End users are a partner's customers, each identified by a wallet address. They own the files they upload, which are charged to the organization's account, and are not members of the organization. All or none of the end users in a request are enrolled. A customer reference is permanent once given to an address. An end user already enrolled with the same customer reference and quota is returned as it is, so a request can be retried. A removed end user is enrolled again with the quota of the request, under the same customer reference only.`,
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
                            'Your own reference for the customer, unique among the end users of the organization, removed ones included, and fixed once given. Use a pseudonymous ID, never personal data.',
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
              'Not an organization admin or the organization API key, or a key without the end_user_enrollment scope',
          },
          '404': { description: 'Not a partner organization' },
          '409': { description: enrollmentConflict },
        },
      },
      get: {
        summary: 'Organizations - List end users',
        description: `${endUsersAccess('`end_user_enrollment` or `end_user_removal`')} Auto Drive admins may list them too. Removed end users are included, with \`removedAt\` set, so a mass removal can be reversed by enrolling them again. Ordered by first enrollment.`,
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
            description:
              'A page of end users, and how many there are, removed ones included',
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
              'Not an organization admin, the organization API key or an Auto Drive admin, or a key with neither end user scope',
          },
          '404': { description: 'Not a partner organization' },
        },
      },
    },
    '/organizations/{organizationId}/end-users/{address}': {
      delete: {
        summary: 'Organizations - Remove an end user',
        description: `${endUsersAccess('`end_user_removal`')} Auto Drive admins may remove them too. The end user stays in the organization with read-only access to their files and no longer counts towards its end users. Enrolling them again undoes it. Removing an end user already removed succeeds, so a request can be retried.`,
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
          '204': { description: 'Removed, now or before' },
          '400': { description: 'Not an address' },
          '401': { description: 'Unauthorized' },
          '403': {
            description:
              'Not an organization admin, the organization API key or an Auto Drive admin, or a key without the end_user_removal scope',
          },
          '404': {
            description:
              'Not a partner organization, or not an end user of the organization',
          },
        },
      },
    },
    '/organizations/{organizationId}/partner-origins': {
      get: {
        summary: 'Organizations - List partner origins',
        description:
          'For Auto Drive admins. The https origins of the partner app. A wallet sign-in for one is accepted only from end users of the organization, who can sign in for nothing else.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [organizationIdParameter],
        responses: {
          '200': {
            description: 'The origins, oldest first',
            content: {
              'application/json': {
                schema: { type: 'array', items: partnerOriginSchema },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Not an Auto Drive admin' },
          '404': { description: 'Not a partner organization' },
        },
      },
      post: {
        summary: 'Organizations - Add a partner origin',
        description:
          'For Auto Drive admins. The origin is only an identifier in the signed message and never needs to resolve, so it stays the same if the partner changes its domain.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [organizationIdParameter],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['origin'],
                properties: {
                  origin: {
                    type: 'string',
                    example: 'https://app.example.com',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'The origin',
            content: { 'application/json': { schema: partnerOriginSchema } },
          },
          '400': { description: 'Not an https origin' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Not an Auto Drive admin' },
          '404': { description: 'Not a partner organization' },
          '409': {
            description:
              'Already registered, for this or another organization, or an archived organization',
          },
        },
      },
      delete: {
        summary: 'Organizations - Remove a partner origin',
        description:
          'For Auto Drive admins. Refused while the organization has end users, removed ones included, because they sign in only through its origins.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [organizationIdParameter, originParameter],
        responses: {
          '204': { description: 'Removed' },
          '400': { description: 'No origin, or not an https origin' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Not an Auto Drive admin' },
          '404': {
            description:
              'Not a partner organization, or not an origin of the organization',
          },
          '409': { description: 'The organization has end users' },
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
        enum: ['files', 'end_user_enrollment', 'end_user_removal', 'usage'],
        description:
          '`files`: /uploads, /objects, /downloads and /s3. `usage`: the usage report routes. `end_user_enrollment`: enrolling and listing the end users of the organization. `end_user_removal`: listing and removing them.',
      },
    },
  },
}
