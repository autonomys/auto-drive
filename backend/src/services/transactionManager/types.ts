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
