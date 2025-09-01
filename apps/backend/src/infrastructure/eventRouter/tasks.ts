import z from 'zod'
import { ObjectMappingSchema } from '@auto-drive/models'
import { config } from '../../config.js'
import { exhaustiveCheck } from '../../shared/utils/misc.js'

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
    retriesLeft: z.number().default(MAX_RETRIES),
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
  z.object({
    id: z.literal('async-download-created'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({
      downloadId: z.string(),
    }),
  }),
  z.object({
    id: z.literal('object-archived'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({
      cid: z.string(),
    }),
  }),
])

export type MigrateUploadTask = z.infer<typeof TaskSchema>
export type Task = MigrateUploadTask

type TaskCreateParams =
  | {
      id: 'migrate-upload-nodes'
      params: {
        uploadId: string
      }
    }
  | {
      id: 'archive-objects'
      params: {
        objects: z.infer<typeof ObjectMappingSchema>[]
      }
    }
  | {
      id: 'publish-nodes'
      params: {
        nodes: string[]
      }
    }
  | {
      id: 'tag-upload'
      params: {
        cid: string
      }
    }
  | {
      id: 'async-download-created'
      params: {
        downloadId: string
      }
    }
  | {
      id: 'object-archived'
      params: {
        cid: string
      }
    }

export const createTask = (task: TaskCreateParams): Task => {
  switch (task.id) {
    case 'migrate-upload-nodes':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'archive-objects':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'publish-nodes':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'tag-upload':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'async-download-created':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'object-archived':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    default:
      return exhaustiveCheck(task)
  }
}
