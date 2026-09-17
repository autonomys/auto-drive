import z from 'zod'
import { ObjectMappingSchema, PaymentMethod } from '@auto-drive/models'
import { config } from '../../config.js'
import { exhaustiveCheck } from '../../shared/utils/misc.js'

export const MAX_RETRIES = config.params.taskManagerMaxRetries

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
  z.object({
    id: z.literal('ensure-object-published'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({
      cid: z.string(),
    }),
  }),
  z.object({
    id: z.literal('watch-intent-tx'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({
      txHash: z.string(),
      // Which chain the hash was submitted to. Optional, defaulting to AI3, for
      // the tasks already on the queue when this field was added: they are all
      // AI3 by construction, and rejecting them would drop watch requests for
      // payments that are already on chain.
      paymentMethod: z
        .nativeEnum(PaymentMethod)
        .optional()
        .default(PaymentMethod.AI3_NATIVE),
    }),
  }),
  z.object({
    id: z.literal('populate-cache'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({
      cid: z.string(),
    }),
  }),
  z.object({
    id: z.literal('reconcile-archival'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({}),
  }),
  z.object({
    id: z.literal('recover-publishing'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({}),
  }),
  z.object({
    id: z.literal('recover-migrations'),
    retriesLeft: z.number().default(MAX_RETRIES),
    params: z.object({}),
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
  | {
      id: 'ensure-object-published'
      params: {
        cid: string
      }
    }
  | {
      id: 'watch-intent-tx'
      params: {
        txHash: string
        // Required of every publisher, optional on the wire. The schema above
        // defaults it so a task queued before this field existed still parses;
        // this type has no such history to accommodate, and a publisher that
        // omitted it would be choosing a chain by accident.
        paymentMethod: PaymentMethod
      }
    }
  | {
      id: 'populate-cache'
      params: {
        cid: string
      }
    }
  | {
      id: 'reconcile-archival'
      params: Record<string, never>
    }
  | {
      id: 'recover-publishing'
      params: Record<string, never>
    }
  | {
      id: 'recover-migrations'
      params: Record<string, never>
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
    case 'ensure-object-published':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'watch-intent-tx':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'populate-cache':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'reconcile-archival':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'recover-publishing':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    case 'recover-migrations':
      return {
        id: task.id,
        params: task.params,
        retriesLeft: MAX_RETRIES,
      }
    default:
      return exhaustiveCheck(task)
  }
}
