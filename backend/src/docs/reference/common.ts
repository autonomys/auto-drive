export const common = {
  components: {
    schemas: {
      UploadOptions: {
        type: 'object',
        properties: {
          compression: {
            $ref: '#/components/schemas/CompressionOptions',
          },
          encryption: {
            $ref: '#/components/schemas/EncryptionOptions',
          },
        },
      },
      CompressionOptions: {
        type: 'object',
        properties: {
          algorithm: { type: 'string', enum: ['ZLIB'] },
          level: { type: 'integer', default: 8 },
        },
      },
      EncryptionOptions: {
        type: 'object',
        properties: {
          algorithm: { type: 'string', enum: ['AES_256_GCM'] },
          chunkSize: { type: 'integer', default: 1024 },
        },
      },
    },
  },
}
