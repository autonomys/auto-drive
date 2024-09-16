import { Transaction } from "../services/transactionManager";
import { ApiPromise } from "@polkadot/api";

export interface Queue {
  transactions: TransactionInfo[];
  api: ApiPromise | null;
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
