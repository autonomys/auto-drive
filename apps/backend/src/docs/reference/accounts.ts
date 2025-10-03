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
}
