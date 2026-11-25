import { autoDriveServers } from './servers.js'

export const accounts = {
  paths: {
    '/accounts/@me': {
      get: {
        summary: 'Accounts - Get current user account information',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        responses: {
          '200': {
            description: 'Successfully retrieved account information',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    account: {
                      $ref: '#/components/schemas/AccountInfo',
                    },
                  },
                  required: [
                    'id',
                    'organizationId',
                    'uploadLimit',
                    'downloadLimit',
                    'model',
                    'pendingUploadCredits',
                    'pendingDownloadCredits',
                  ],
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
          },
          '500': {
            description: 'Failed to get user info',
          },
        },
      },
    },
    '/accounts/update': {
      post: {
        summary: 'Accounts - Update an account (admin)',
        description:
          'Sets the model, allowances and credit terms of an account. Admin only. Optional terms left out stay as they are; for the overrides, null restores the global default. Each change is recorded in the account terms history.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  accountId: { type: 'string' },
                  model: { type: 'string', enum: ['monthly', 'one_off'] },
                  uploadLimit: {
                    type: 'number',
                    description:
                      'Free upload allowance. Must be 0 on a partner account.',
                  },
                  downloadLimit: { type: 'number' },
                  maxPurchasedBytes: {
                    type: 'integer',
                    nullable: true,
                    description: 'Cap on purchased credits held.',
                  },
                  creditExpiryDays: {
                    type: 'integer',
                    nullable: true,
                    minimum: 1,
                    maximum: 36500,
                  },
                  monthlyFreeUploadBytes: {
                    type: 'integer',
                    minimum: 0,
                    description:
                      'Free upload bytes issued to a partner account each UTC calendar month, used before purchased credits and expiring at the end of the month. 0 for none. A change applies at once, as a change to the upload limit of a regular account does: the free credits of the month become the new amount less what has been used this month. Partner accounts on the monthly model only: the one-off model needs 0, and switching to it with 0 ends the free credits of the month.',
                  },
                  reason: { type: 'string', maxLength: 500 },
                },
                required: [
                  'accountId',
                  'model',
                  'uploadLimit',
                  'downloadLimit',
                ],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Account updated' },
          '400': {
            description: 'Invalid body, or terms the account cannot have',
          },
          '403': { description: 'Not an admin' },
          '404': { description: 'Account not found' },
        },
      },
    },
    '/accounts/admin/{id}/free-credits': {
      get: {
        summary: 'Accounts - List free credits (admin)',
        description:
          'The free credit batches of the account, monthly and one-time, newest first. Admin only.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Free credit batches',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/FreeCredit' },
                },
              },
            },
          },
          '403': { description: 'Not an admin' },
          '404': { description: 'Account not found' },
        },
      },
      post: {
        summary: 'Accounts - Grant free credits (admin)',
        description:
          'Grants a partner account one-time free upload credits. They are used before purchased credits, do not count toward the cap on purchased credits held, and cannot be refunded. Admin only.',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  uploadBytes: { type: 'integer', minimum: 1 },
                  expiresInDays: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 36500,
                    description:
                      'Defaults to the credit expiry of the account.',
                  },
                  reason: { type: 'string', minLength: 1, maxLength: 500 },
                },
                required: ['uploadBytes', 'reason'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'The granted batch',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FreeCredit' },
              },
            },
          },
          '400': { description: 'Invalid body, or not a partner account' },
          '403': { description: 'Not an admin' },
          '404': { description: 'Account not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      AccountInfo: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          organizationId: { type: 'string' },
          uploadLimit: { type: 'number' },
          downloadLimit: { type: 'number' },
          module: {
            type: 'string',
            enum: ['monthly', 'one_off'],
          },
          pendingUploadCredits: { type: 'number' },
          pendingDownloadCredits: { type: 'number' },
          freeUploadCredits: {
            type: 'number',
            description:
              'Free credit bytes left, included in pendingUploadCredits.',
          },
          monthlyFreeUploadBytes: {
            type: 'number',
            description: 'Free upload bytes issued each UTC month (partners).',
          },
        },
        required: [
          'id',
          'organizationId',
          'uploadLimit',
          'downloadLimit',
          'model',
          'pendingUploadCredits',
          'pendingDownloadCredits',
        ],
      },
      FreeCredit: {
        type: 'object',
        description: 'Byte counts are decimal strings.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          accountId: { type: 'string' },
          kind: { type: 'string', enum: ['free_one_time', 'free_monthly'] },
          grantPeriod: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Start of the UTC month, for monthly free credits.',
          },
          supersededAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description:
              'Monthly free credits only: when a change to the monthly amount ended this batch and a batch for the rest of the month replaced it.',
          },
          grantedBy: {
            type: 'string',
            nullable: true,
            description: 'Admin publicId, for one-time free credits.',
          },
          grantReason: { type: 'string', nullable: true },
          uploadBytesOriginal: { type: 'string' },
          uploadBytesRemaining: { type: 'string' },
          purchasedAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          expired: { type: 'boolean' },
        },
      },
    },
  },
}
