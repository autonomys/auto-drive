import { ApiPromise } from "@polkadot/api";
import {
  ApiTypes,
  SubmittableExtrinsic,
  SubmittableResultValue,
} from "@polkadot/api/types";
import { KeyringPair } from "@polkadot/keyring/types";
import { waitReady } from "@polkadot/wasm-crypto";
import { createConnection } from "../../drivers/substrate.js";
import { Transaction, TransactionResult } from "../../models/index.js";
import {
  addTransaction,
  getAvailableAccount as getAccount,
  initializeQueue,
  registerTransactionInQueue,
} from "./queue.js";

const submitTransaction = async (
  api: ApiPromise,
  keyPair: KeyringPair,
  transaction: SubmittableExtrinsic<"promise">,
  nonce: number
): Promise<TransactionResult> => {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let isResolved = false;

    const timeout = setTimeout(() => {
      if (unsubscribe) {
        unsubscribe();
      }
      if (!isResolved) {
        console.log(
          `Transaction timed out. Tx hash: ${transaction.hash.toString()}`
        );
        reject(new Error("Transaction timeout"));
      }
    }, 180000); // 3 minutes timeout

    const cleanup = () => {
      clearTimeout(timeout);
      if (unsubscribe) {
        unsubscribe();
      }
    };

    transaction
      .signAndSend(
        keyPair,
        { nonce },
        async (result: SubmittableResultValue) => {
          const { status, events, dispatchError } = result;

          console.log(
            `Current status: ${
              status.type
            }, Tx hash: ${transaction.hash.toString()}`
          );

          if (status.isInBlock || status.isFinalized) {
            cleanup();
            isResolved = true;

            if (dispatchError) {
              let errorMessage;
              if (dispatchError.isModule) {
                const decoded = api.registry.findMetaError(
                  dispatchError.asModule
                );
                errorMessage = `${decoded.section}.${decoded.name}: ${decoded.docs}`;
              } else {
                errorMessage = dispatchError.toString();
              }
              resolve({
                success: false,
                batchTxHash: transaction.hash.toString(),
                status: status.type,
                error: errorMessage,
              });
            } else {
              console.log(`In block: ${status.asInBlock.toString()}`);
              resolve({
                success: true,
                batchTxHash: transaction.hash.toString(),
                blockHash: status.asInBlock.toString(),
                status: status.type,
              });
            }
          } else if (status.isInvalid || status.isUsurped) {
            cleanup();
            isResolved = true;
            reject(new Error(`Transaction ${status.type}`));
          }
        }
      )
      .then((unsub) => {
        unsubscribe = unsub;
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
};

export const createTransactionManager = () => {
  let api: ApiPromise;

  const ensureInitialized = async (): Promise<void> => {
    await waitReady();
    api = await createConnection();
    initializeQueue(api);
  };

  const submit = async (
    transactions: Transaction[]
  ): Promise<TransactionResult[]> => {
    await ensureInitialized();

    const promises: Promise<TransactionResult>[] = [];
    for (const transaction of transactions) {
      const { account, nonce } = await registerTransactionInQueue(transaction);

      const trx = api.tx[transaction.module][transaction.method](
        ...transaction.params
      );

      promises.push(submitTransaction(api, account, trx, nonce));
    }

    return Promise.all(promises);
  };

  return { submit };
};
