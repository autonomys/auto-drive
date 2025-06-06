import { autoDriveServers } from './servers.js'

export const objects = {
  paths: {
    '/objects/roots': {
      get: {
        summary: 'Objects - Get root objects',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'scope',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['global', 'user'],
            },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
            },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved root objects',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ObjectSummary' },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
          },
          '500': {
            description: 'Failed to retrieve root objects',
          },
        },
      },
    },
    '/objects/roots/shared': {
      get: {
        summary: 'Objects - Get shared root objects',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
            },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved shared root objects',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ObjectSummary' },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
          },
          '500': {
            description: 'Failed to retrieve shared root objects',
          },
        },
      },
    },
    '/objects/roots/deleted': {
      get: {
        summary: 'Objects - Get deleted root objects',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
            },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved deleted root objects',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ObjectSummary' },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
          },
          '500': {
            description: 'Failed to retrieve deleted root objects',
          },
        },
      },
    },
    '/objects/search': {
      get: {
        summary: 'Objects - Search for objects by CID or name',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'cid',
            description: 'The CID or name of the object to search for',
            in: 'query',
            required: true,
            schema: {
              type: 'string',
            },
          },
          {
            name: 'scope',
            description: 'The scope of the search',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['user', 'global'],
            },
          },
          {
            name: 'limit',
            description: 'The maximum number of results to return',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved search results',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ObjectSearchResult' },
                },
              },
            },
          },
          '400': {
            description: 'Missing or invalid cid value',
          },
          '500': {
            description: 'Failed to search metadata',
          },
        },
      },
    },
    '/objects/{cid}/summary': {
      get: {
        summary: 'Objects - Get summary of an object by CID',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
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
            description: 'Successfully retrieved object summary',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ObjectSummary',
                },
              },
            },
          },
          '404': {
            description: 'Metadata not found',
          },
          '500': {
            description: 'Failed to retrieve metadata',
          },
        },
      },
    },
    '/objects/{cid}/metadata': {
      get: {
        summary: 'Objects - Get metadata of an object by CID',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
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
            description: 'Successfully retrieved object metadata',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/OffchainMetadata',
                },
              },
            },
          },
          '404': {
            description: 'Metadata not found',
          },
          '500': {
            description: 'Failed to retrieve metadata',
          },
        },
      },
    },
    '/objects/{cid}/status': {
      get: {
        summary: 'Objects - Get upload status of an object by CID',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
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
            description: 'Successfully retrieved upload status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UploadStatus' },
              },
            },
          },
          '500': {
            description: 'Failed to retrieve upload status',
          },
        },
      },
    },
    '/objects/{cid}/share': {
      post: {
        summary: 'Objects - Share an object by CID',
        tags: ['Auto Drive API'],
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
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  publicId: { type: 'string' },
                },
                required: ['publicId'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successfully shared object',
          },
          '400': {
            description: 'Missing `publicId` in request body',
          },
          '401': {
            description: 'Unauthorized',
          },
          '500': {
            description: 'Failed to share object',
          },
        },
      },
    },
    '/objects/{cid}/download': {
      get: {
        deprecated: true,
        summary: 'Objects - Download an object by CID',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
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
    '/objects/{cid}/delete': {
      post: {
        summary: 'Objects - Delete an object by CID',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
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
            description: 'Successfully deleted object',
          },
          '401': {
            description: 'Unauthorized',
          },
          '500': {
            description: 'Failed to delete object',
          },
        },
      },
    },
    '/objects/{cid}/restore': {
      post: {
        summary: 'Objects - Restore a deleted object by CID',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
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
            description: 'Successfully restored object',
          },
          '401': {
            description: 'Unauthorized',
          },
          '500': {
            description: 'Failed to restore object',
          },
        },
      },
    },
    '/objects/{cid}/publish': {
      post: {
        summary: 'Objects - Publish an object by CID and return the object id',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
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
            description: 'Successfully published object',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    result: { type: 'string' },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
          },
          '500': {
            description: 'Failed to publish object',
          },
        },
      },
    },
    '/objects/{cid}/unpublish': {
      post: {
        summary: 'Objects - Unpublish an object by CID',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
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
          '204': {
            description: 'Successfully unpublished object',
          },
          '401': {
            description: 'Unauthorized',
          },
          '500': {
            description: 'Failed to unpublish object',
          },
        },
      },
    },
    '/objects/{id}/public': {
      get: {
        summary: 'Objects - Download a published object by id',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'id',
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
            description: 'Published object not found',
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
      ObjectSummary: {
        type: 'object',
        properties: {
          headCid: { type: 'string' },
          name: { type: 'string', nullable: true },
          size: { type: 'string' },
          owners: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                oauthProvider: { type: 'string' },
                oauthUserId: { type: 'string' },
                role: { type: 'string', enum: ['admin', 'viewer'] },
              },
            },
          },
          uploadStatus: { $ref: '#/components/schemas/UploadStatus' },
          createdAt: { type: 'string', format: 'iso8601' },
          type: { type: 'string', enum: ['file', 'folder'] },
          mimeType: { type: 'string', nullable: true },
          children: {
            type: 'array',
            items: {
              type: 'object',
            },
            nullable: true,
          },
        },
        required: [
          'headCid',
          'size',
          'owners',
          'uploadStatus',
          'createdAt',
          'type',
        ],
      },
      ObjectSearchResult: {
        type: 'object',
        properties: {
          cid: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['cid', 'name'],
      },
      OffchainMetadata: {
        type: 'object',
        oneOf: [
          { $ref: '#/components/schemas/OffchainFileMetadata' },
          { $ref: '#/components/schemas/OffchainFolderMetadata' },
        ],
      },
      OffchainFileMetadata: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['file'] },
          dataCid: { type: 'string' },
          name: { type: 'string', nullable: true },
          mimeType: { type: 'string', nullable: true },
          totalSize: { type: 'string' },
          totalChunks: { type: 'integer' },
          chunks: {
            type: 'array',
            items: { $ref: '#/components/schemas/ChunkInfo' },
          },
          uploadOptions: { $ref: '#/components/schemas/UploadOptions' },
        },
      },
      ChunkInfo: {
        type: 'object',
        properties: {
          size: { type: 'string' },
          cid: { type: 'string' },
        },
      },
      OffchainFolderMetadata: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['folder'] },
          dataCid: { type: 'string' },
          name: { type: 'string', nullable: true },
          totalSize: { type: 'string' },
          totalFiles: { type: 'integer' },
          children: {
            type: 'array',
            items: { $ref: '#/components/schemas/ChildrenMetadata' },
          },
          uploadOptions: { $ref: '#/components/schemas/UploadOptions' },
        },
      },
      ChildrenMetadata: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['file', 'folder'] },
          cid: { type: 'string' },
          name: { type: 'string', nullable: true },
          totalSize: { type: 'string' },
        },
        required: ['type', 'cid', 'totalSize'],
      },
      UploadStatus: {
        type: 'object',
        properties: {
          uploadedNodes: { type: 'integer', nullable: true },
          totalNodes: { type: 'integer', nullable: true },
          archivedNodes: { type: 'integer', nullable: true },
          minimumBlockDepth: { type: 'integer', nullable: true },
          maximumBlockDepth: { type: 'integer', nullable: true },
        },
      },
    },
  },
}
