import { getPrismaClient } from '../../drivers/prisma.js'

export const blockstoreRepository = getPrismaClient().blockstoreEntry
