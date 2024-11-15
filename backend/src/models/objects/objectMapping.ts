import { z } from 'zod'

export type ObjectMapping = [
  hash: string,
  pieceIndex: number,
  pieceOffset: number,
]

export const ObjectMappingSchema = z.tuple([z.string(), z.number(), z.number()])

export const ObjectMappingListEntrySchema = z.object({
  blockNumber: z.number(),
  v0: z.object({
    objects: z.array(ObjectMappingSchema),
  }),
})

export type ObjectMappingListEntry = z.infer<
  typeof ObjectMappingListEntrySchema
>
