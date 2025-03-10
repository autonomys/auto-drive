import { ApiPromise } from '@polkadot/api'
import z from 'zod'

export interface Queue {
  transactions: TransactionInfo[]
  api: ApiPromise | null
  updatePeriod: number
  transactionRetryPeriod: number
  transactionRetryLimit: number
}

interface TransactionInfo {
  transaction: Transaction
  nonce: number
  account: string
  status: TransactionStatus
  sentAt: number
  retries: number
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}

export type Transaction = {
  module: string
  method: string
  params: unknown[]
}

export const TransactionResultSchema = z.object({
  success: z.boolean(),
  blockNumber: z.number().optional(),
  txHash: z.string().optional(),
  blockHash: z.string().optional(),
  status: z.string(),
  error: z.string().optional(),
})

export type TransactionResult = z.infer<typeof TransactionResultSchema>
