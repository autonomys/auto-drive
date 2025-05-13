import z from 'zod'
import { ObjectMappingSchema } from '@auto-drive/models'
import { config } from '../../config.js'

export const MAX_RETRIES = config.services.taskManager.maxRetries

export const TaskSchema = z.discriminatedUnion('id', [
  z.object({
    id: z.literal('migrate-upload-nodes'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({
      uploadId: z.string(),
    }),
  }),
  z.object({
    id: z.literal('archive-objects'),
    retriesLeft: z.number().default(0),
    params: z.object({
      objects: z.array(ObjectMappingSchema),
    }),
  }),
  z.object({
    id: z.literal('publish-nodes'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({
      nodes: z.array(z.string()),
    }),
  }),
  z.object({
    id: z.literal('tag-upload'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({
      cid: z.string(),
    }),
  }),
])

export type MigrateUploadTask = z.infer<typeof TaskSchema>
export type Task = MigrateUploadTask
