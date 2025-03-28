import z from 'zod'
import { ObjectMappingSchema } from '@auto-drive/models'

export const TaskSchema = z.discriminatedUnion('id', [
  z.object({
    id: z.literal('migrate-upload-nodes'),
    params: z.object({
      uploadId: z.string(),
    }),
  }),
  z.object({
    id: z.literal('archive-objects'),
    params: z.object({
      objects: z.array(ObjectMappingSchema),
    }),
  }),
  z.object({
    id: z.literal('publish-nodes'),
    params: z.object({
      nodes: z.array(z.string()),
    }),
  }),
  z.object({
    id: z.literal('tag-upload'),
    params: z.object({
      cid: z.string(),
    }),
  }),
])

export type MigrateUploadTask = z.infer<typeof TaskSchema>
export type Task = MigrateUploadTask
