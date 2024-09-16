import { SubmittableExtrinsic } from "@polkadot/api/submittable/types";
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
}

export enum TransactionStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  FAILED = "FAILED",
}
