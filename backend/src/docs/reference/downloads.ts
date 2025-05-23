export const downloads = {
  paths: {
    '/downloads/async': {
      post: {
        summary: 'Creates an async download for an object by CID',
        tags: ['Downloads'],
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
        summary: 'Dismisses an async download',
        tags: ['Downloads'],
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
        summary: 'Download an object by CID',
        tags: ['Downloads'],
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
    },
  },
}
