import { autoDriveServers } from './servers.js'

export const subscriptions = {
  paths: {
    '/subscriptions/@me': {
      get: {
        summary: 'Subscriptions - Get current user subscription information',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        responses: {
          '200': {
            description: 'Successfully retrieved subscription information',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    subscription: {
                      $ref: '#/components/schemas/SubscriptionInfo',
                    },
                  },
                  required: [
                    'id',
                    'organizationId',
                    'uploadLimit',
                    'downloadLimit',
                    'granularity',
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
  },
  components: {
    schemas: {
      SubscriptionInfo: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          organizationId: { type: 'string' },
          uploadLimit: { type: 'number' },
          downloadLimit: { type: 'number' },
          granularity: { type: 'string', enum: ['monthly'] },
          pendingUploadCredits: { type: 'number' },
          pendingDownloadCredits: { type: 'number' },
        },
        required: [
          'id',
          'organizationId',
          'uploadLimit',
          'downloadLimit',
          'granularity',
          'pendingUploadCredits',
          'pendingDownloadCredits',
        ],
      },
    },
  },
}
