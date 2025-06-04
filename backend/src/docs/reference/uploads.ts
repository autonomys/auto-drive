import { autoDriveServers } from './servers.js'

export const uploads = {
  paths: {
    '/uploads/file': {
      post: {
        summary: 'Uploads - Upload a file',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  mimeType: { type: 'string' },
                  uploadOptions: {
                    $ref: '#/components/schemas/UploadOptions',
                  },
                },
                required: ['filename'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'File uploaded successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid input',
          },
          '500': {
            description: 'Failed to create upload',
          },
        },
      },
    },
    '/uploads/folder': {
      post: {
        summary: 'Uploads - Create a new folder upload',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fileTree: { $ref: '#/components/schemas/FolderTree' },
                  uploadOptions: {
                    $ref: '#/components/schemas/UploadOptions',
                  },
                },
                required: ['fileTree'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Folder created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid input',
          },
          '500': {
            description: 'Failed to create upload',
          },
        },
      },
    },
    '/uploads/folder/{folderUploadId}/file': {
      post: {
        summary:
          'Uploads - Create a file in a folder provided by the folder upload id',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'folderUploadId',
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
                  name: {
                    type: 'string',
                    description: 'The name of the file',
                  },
                  mimeType: {
                    type: 'string',
                    description: 'The mime type of the file',
                  },
                  relativeId: {
                    type: 'string',
                    description:
                      'The id of the uploaded file within the file tree',
                  },
                  uploadOptions: {
                    $ref: '#/components/schemas/UploadOptions',
                  },
                },
                required: ['name', 'relativeId'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'File created in folder successfully',
          },
          '400': {
            description: 'Invalid input',
          },
          '500': {
            description: 'Failed to create file in folder',
          },
        },
      },
    },
    '/uploads/file/{uploadId}/chunk': {
      post: {
        summary: 'Uploads - Upload a chunk of a file',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'uploadId',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: {
                    type: 'string',
                    format: 'binary',
                  },
                  index: {
                    type: 'integer',
                  },
                },
                required: ['file', 'index'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Chunk uploaded successfully',
          },
          '400': {
            description: 'Invalid input',
          },
          '500': {
            description: 'Failed to upload chunk',
          },
        },
      },
    },
    '/uploads/file/{uploadId}/complete': {
      post: {
        summary: 'Uploads - Complete the upload returning the file CID',
        tags: ['Auto Drive API'],
        servers: autoDriveServers,
        parameters: [
          {
            name: 'uploadId',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Upload completed successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { cid: { type: 'string' } },
                },
              },
            },
          },
          '500': {
            description: 'Failed to complete upload',
          },
        },
      },
    },
  },
  components: {
    schemas: {
      FolderTreeFolder: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['folder', 'file'] },
          children: {
            $ref: '#/components/schemas/FolderTree',
          },
        },
      },
      FolderTreeFile: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['file'] },
          id: { type: 'string' },
        },
      },
      FolderTree: {
        oneOf: [
          { $ref: '#/components/schemas/FolderTreeFolder' },
          { $ref: '#/components/schemas/FolderTreeFile' },
        ],
      },
    },
  },
}
