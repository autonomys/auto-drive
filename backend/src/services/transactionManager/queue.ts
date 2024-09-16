import { KeyringPair } from "@polkadot/keyring/types";
import { Queue, TransactionStatus } from "../../models/transaction.js";
import { getAccounts } from "./accountPool.js";
import { ApiPromise } from "@polkadot/api";
import { Transaction } from "./types.js";
import { getOnChainNonce } from "./networkApi.js";

export const queue: Queue = {
  api: null,
  transactions: [],
};

export const getAvailableAccount = (): KeyringPair => {
  if (!queue.api) {
    throw new Error("Queue not initialized");
  }

  const accounts = getAccounts();

  const account = accounts.reduce(
    (accountWithMinimumQueuedTrxs, account) =>
      queue.transactions.filter(
        (tx) => tx.account === accountWithMinimumQueuedTrxs.address
      ).length >
      queue.transactions.filter((tx) => tx.account === account.address).length
        ? account
        : accountWithMinimumQueuedTrxs,
    accounts[0]
  );

  return account;
};

export const getAccountNonce = async (
  api: ApiPromise,
  address: string
): Promise<number> => {
  if (!queue.api) {
    throw new Error("Queue not initialized");
  }

  const [highestNonceTrx] = queue.transactions
    .filter((tx) => tx.account === address)
    .sort((a, b) => a.nonce - b.nonce);

  if (highestNonceTrx) {
    return highestNonceTrx.nonce;
  }

  const nonce = await getOnChainNonce(api, address);
  return nonce;
};

export const addTransaction = (
  transaction: Transaction,
  nonce: number,
  account: KeyringPair
) => {
  if (!queue.api) {
    throw new Error("Queue not initialized");
  }

  queue.transactions.push({
    transaction,
    nonce,
    account: account.address,
    status: TransactionStatus.PENDING,
  });
};

export const drainQueue = async () => {
  if (!queue.api) {
    throw new Error("Queue not initialized");
  }

  for (const account of getAccounts()) {
    const nonce = await getOnChainNonce(queue.api, account.address);
    queue.transactions = queue.transactions.filter(
      (tx) => tx.account !== account.address || tx.nonce > nonce
    );
  }

  console.log(
    `Queue drained there are ${queue.transactions.length} transactions left`
  );

  setTimeout(drainQueue, 10_000);
};

export const initializeQueue = (api: ApiPromise) => {
  queue.api = api;

  setTimeout(drainQueue, 10_000);
};
