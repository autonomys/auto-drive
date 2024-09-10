import {
  storeData,
  retrieveData,
  storeTransactionResult,
} from "../../api/index.js";
import {
  createTransactionManager,
  TransactionResult,
} from "../transactionManager/index.js";
import { isJson } from "../../utils/index.js";
import dotenv from "dotenv";
import { cidToString, fileToIpldPbDag } from "@autonomys/auto-drive";
import { createNode, encode, decode } from "@ipld/dag-pb";
import {
  ChunkInfo,
  chunkInfoFromNode,
  fileMetadata as createFileMetadata,
  Metadata,
} from "../../models/index.js";

dotenv.config();

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "ws://localhost:9944";
const KEYPAIR_URI = process.env.KEYPAIR_URI || "//Alice";

const storeMetadata = async (metadata: Metadata): Promise<string> => {
  const metadataString = JSON.stringify(metadata);
  return await storeData(`metadata:${metadata.dataCid}`, metadataString);
};

const storeChunks = async (chunks: ChunkInfo[]): Promise<void> => {
  await Promise.all(
    chunks.map((chunk) => storeData(chunk.cid, chunk.data.toString("base64")))
  );
};

export const processData = async (
  data: Buffer,
  filename?: string,
  mimeType?: string
): Promise<{ cid: string; transactionResults: TransactionResult[] }> => {
  const dag = fileToIpldPbDag(data);

  const metadata: Metadata = createFileMetadata(
    dag,
    data.length,
    filename,
    mimeType
  );

  const metadataPbFormatted = encode(
    createNode(Buffer.from(JSON.stringify(metadata)), [])
  );

  const chunkNodes = Array.from(dag.nodes.values());

  const transactionManager = createTransactionManager(
    RPC_ENDPOINT!,
    KEYPAIR_URI!
  );
  const transactions = [
    {
      module: "system",
      method: "remarkWithEvent",
      params: [metadataPbFormatted],
    },
    ...chunkNodes
      .map((e) => Buffer.from(encode(e)))
      .map((chunk) => ({
        module: "system",
        method: "remarkWithEvent",
        params: [chunk.toString("base64")],
      })),
  ];

  const results: TransactionResult[] = await transactionManager.submit(
    transactions
  );

  await storeMetadata(metadata);
  await storeChunks(chunkNodes.map(chunkInfoFromNode));

  await storeTransactionResult(
    cidToString(dag.headCID),
    JSON.stringify(results)
  );

  return { cid: cidToString(dag.headCID), transactionResults: results };
};

export const retrieveAndReassembleData = async (
  metadataCid: string
): Promise<Buffer> => {
  const metadataString = await retrieveData(metadataCid);
  if (!metadataString || !isJson(metadataString)) {
    throw new Error("Metadata not found");
  }

  const metadata: Metadata = JSON.parse(metadataString);

  if (metadata.totalChunks === 1) {
    const data = await retrieveData(metadata.chunks[0].cid);
    if (!data) {
      throw new Error(`Data with CID ${metadata.chunks[0].cid} not found`);
    }
    console.log("data", data);
    return Buffer.from(data, "base64");
  }

  const chunks: Buffer[] = await Promise.all(
    metadata.chunks.map(async (chunk) => {
      const chunkData = await retrieveData(chunk.cid);
      if (!chunkData) {
        throw new Error(`Chunk with CID ${chunk.cid} not found`);
      }
      return Buffer.from(decode(Buffer.from(chunkData, "base64")).Data ?? "");
    })
  );

  return Buffer.concat(chunks);
};
