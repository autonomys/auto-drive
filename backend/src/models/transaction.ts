import { ApiPromise } from "@polkadot/api";
import { Transaction } from "../services/transactionManager";

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
