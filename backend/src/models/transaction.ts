import { ApiPromise } from "@polkadot/api";

export interface Queue {
  transactions: TransactionInfo[];
  api: ApiPromise | null;
  updatePeriod: number;
  transactionRetryPeriod: number;
  transactionRetryLimit: number;
}

interface TransactionInfo {
  transaction: Transaction;
  nonce: number;
  account: string;
  status: TransactionStatus;
  sentAt: number;
  retries: number;
}

export enum TransactionStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  FAILED = "FAILED",
}

export type Transaction = {
  module: string;
  method: string;
  params: any[];
};

export type TransactionResult = {
  success: boolean;
  batchTxHash: string;
  blockHash?: string;
  status: string;
  error?: string;
};
