import { PrismaClient } from '@prisma/client'
import { config } from '../config.js'

let prisma: PrismaClient | undefined

export const getPrismaClient = (): PrismaClient => {
  if (!prisma) {
    console.log('Creating Prisma client: ', config.postgres.url)
    prisma = new PrismaClient({
      datasourceUrl: config.postgres.url,
    })
  }

  return prisma
}

export const closePrismaClient = async (): Promise<void> => {
  const _prisma = prisma
  prisma = undefined
  await _prisma?.$disconnect()
}
