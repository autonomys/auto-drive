import { decodeIPLDNodeData } from "@autonomys/auto-drive";
import { initDatabase } from "../database/index.js";

let dbOps: Awaited<ReturnType<typeof initDatabase>> | null = null;

const ensureDbInitialized = async () => {
  if (!dbOps) {
    dbOps = await initDatabase();
  }
};

export const storeData = async (key: string, data: string): Promise<string> => {
  await ensureDbInitialized();
  await dbOps!.setData(key, data);
  return key;
};

export const retrieveNodeData = async (
  key: string
): Promise<string | undefined> => {
  await ensureDbInitialized();
  return await dbOps!.getData(key);
};

export const retrieveChunkData = async (
  key: string
): Promise<Buffer | undefined> => {
  await ensureDbInitialized();
  const nodeData = await dbOps!.getData(key);
  if (!nodeData) {
    return undefined;
  }

  const fileData = decodeIPLDNodeData(Buffer.from(nodeData, "base64")).data;
  if (!fileData) {
    return undefined;
  }

  return Buffer.from(fileData);
};

//TODO: add pagination
export const getAllData = async (): Promise<
  Array<{ key: string; value: string }>
> => {
  await ensureDbInitialized();
  return await dbOps!.getAllData();
};

//TODO: add pagination
export const getAllMetadata = async (): Promise<
  Array<{ key: string; value: string }>
> => {
  await ensureDbInitialized();
  return await dbOps!.getAllMetadata();
};

export const storeTransactionResult = async (
  key: string,
  data: string
): Promise<string> => {
  await ensureDbInitialized();
  await dbOps!.setTransactionResult(key, data);
  return key;
};

export const retrieveTransactionResult = async (
  key: string
): Promise<string | undefined> => {
  await ensureDbInitialized();
  return await dbOps!.getTransactionResult(key);
};

//TODO: add pagination
export const getAllTransactionResults = async (): Promise<
  Array<{ key: string; value: string }>
> => {
  await ensureDbInitialized();
  return await dbOps!.getAllTransactionResults();
};
