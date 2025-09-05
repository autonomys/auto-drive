import { downloadServers } from './servers.js'

export const downloads = {
  paths: {
    '/downloads/async/{cid}': {
      post: {
        summary: 'Downloads - Create async download for an object by CID',
        tags: ['Auto Drive Download Gateway'],
        servers: downloadServers,
        parameters: [
          {
            name: 'cid',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully created async download',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  $ref: '#/components/schemas/AsyncDownload',
                },
              },
            },
          },
        },
      },
    },
    '/downloads/async/{downloadId}/dismiss': {
      post: {
        summary: 'Downloads - Dismiss an async download',
        tags: ['Auto Drive Download Gateway'],
        servers: downloadServers,
        parameters: [
          {
            name: 'downloadId',
            in: 'path',
            required: true,
          },
        ],
        responses: {
          '200': {
            description: 'Successfully dismissed async download',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  $ref: '#/components/schemas/AsyncDownload',
                },
              },
            },
          },
        },
      },
    },
    '/downloads/{cid}': {
      get: {
        summary: 'Downloads - Download an object by CID',
        tags: ['Auto Drive Download Gateway'],
        servers: downloadServers,
        parameters: [
          {
            name: 'cid',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved object for download',
            content: {
              'application/octet-stream': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
          '404': {
            description: 'Metadata not found',
          },
          '500': {
            description: 'Failed to retrieve data',
          },
        },
      },
    },
    '/downloads/async/{downloadId}': {
      get: {
        summary: 'Downloads - Get async download status',
        tags: ['Auto Drive Download Gateway'],
        servers: downloadServers,
        parameters: [
          {
            name: 'downloadId',
            in: 'path',
            required: true,
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved async download status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  $ref: '#/components/schemas/AsyncDownload',
                },
              },
            },
          },
        },
      },
    },
    '/downloads/async/{downloadId}/status': {
      get: {
        summary: 'Downloads - Get async download status',
        tags: ['Auto Drive Download Gateway'],
        servers: downloadServers,
        parameters: [
          {
            name: 'downloadId',
            in: 'path',
            required: true,
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved async download status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  $ref: '#/components/schemas/AsyncDownloadStatus',
                },
              },
            },
          },
        },
      },
    },
    '/downloads/async/@me': {
      get: {
        summary: 'Downloads - Get all async downloads for the current user',
        tags: ['Auto Drive Download Gateway'],
        servers: downloadServers,
        responses: {
          '200': {
            description: 'Successfully retrieved all async downloads',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/AsyncDownload',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      AsyncDownload: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          oauthProvider: { type: 'string' },
          oauthUserId: { type: 'string' },
          cid: { type: 'string' },
          status: {
            type: 'string',
            enum: [
              'pending',
              'downloading',
              'completed',
              'failed',
              'dismissed',
            ],
          },
          errorMessage: { type: 'string', nullable: true },
          fileSize: { type: 'number', nullable: true },
          downloadedBytes: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AsyncDownloadStatus: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['cached', 'not-cached'],
          },
        },
      },
    },
  },
}
