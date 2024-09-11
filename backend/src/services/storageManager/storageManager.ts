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
import {
  cidOfNode,
  cidToString,
  fileToIpldPbDag,
  stringToCid,
} from "@autonomys/auto-drive";
import { createNode, encode, decode, PBNode } from "@ipld/dag-pb";
import {
  fileMetadata as createFileMetadata,
  folderMetadata,
  Metadata,
  metadataToBytes,
} from "../../models/index.js";
import { FolderTree } from "../../models/folderTree.js";

dotenv.config();

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "ws://localhost:9944";
const KEYPAIR_URI = process.env.KEYPAIR_URI || "//Alice";

const storeMetadata = async (metadata: Metadata): Promise<string> => {
  const metadataString = JSON.stringify(metadata);
  return await storeData(`metadata:${metadata.dataCid}`, metadataString);
};

const storeChunks = async (chunks: PBNode[]): Promise<void> => {
  await Promise.all(
    chunks.map((chunk) =>
      storeData(
        cidToString(cidOfNode(chunk)),
        Buffer.from(encode(chunk)).toString("base64")
      )
    )
  );
};

export const processFile = async (
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

  const metadataPbFormatted = metadataToBytes(metadata);

  const chunkNodes = Array.from(dag.nodes.values());

  const transactionManager = createTransactionManager(
    RPC_ENDPOINT!,
    KEYPAIR_URI!
  );
  const transactions = [
    {
      module: "system",
      method: "remarkWithEvent",
      params: [metadataPbFormatted.toString("base64")],
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
  await storeChunks(chunkNodes);

  await storeTransactionResult(
    cidToString(dag.headCID),
    JSON.stringify(results)
  );

  console.log("Processed file: ", filename);
  return { cid: cidToString(dag.headCID), transactionResults: [] };
};

export const processTree = async (
  folderTree: FolderTree,
  files: Express.Multer.File[]
): Promise<{ cid: string; transactionResults: TransactionResult[] }> => {
  if (folderTree.type === "file") {
    const file = files.find((e) => e.fieldname === folderTree.id);
    if (!file) {
      throw new Error(`File with fieldname ${folderTree.id} not found`);
    }

    return processFile(file.buffer, folderTree.name, file.mimetype);
  }

  const parsedChildren = [];
  for (const child of folderTree.children) {
    const result = await processTree(child, files);
    parsedChildren.push(result);
  }

  const cids = parsedChildren.map((e) => e.cid).flat();

  const folderNode = createNode(
    new Uint8Array(0),
    cids.map((e) => ({ Hash: stringToCid(e) }))
  );
  const folderNodeBytes = Buffer.from(encode(folderNode));
  const cid = cidToString(cidOfNode(folderNode));

  const populatedChildren = await Promise.all(
    cids.map((e) => retrieveMetadata(e).then((e) => e!))
  );
  const metadata: Metadata = folderMetadata(cid, populatedChildren);
  const metadataPbFormatted = metadataToBytes(metadata);

  const transactions = [
    {
      module: "system",
      method: "remarkWithEvent",
      params: [metadataPbFormatted.toString("base64")],
    },
    {
      module: "system",
      method: "remarkWithEvent",
      params: [Buffer.from(encode(folderNode)).toString("base64")],
    },
  ];

  console.log(cid);
  console.log("-".repeat(100));

  const transactionManager = createTransactionManager(
    RPC_ENDPOINT!,
    KEYPAIR_URI!
  );
  const transactionResults = await transactionManager.submit(transactions);

  await storeMetadata(metadata);
  await storeData(cid, folderNodeBytes.toString("base64"));

  return { cid, transactionResults };
};

export const retrieveAndReassembleData = async (
  metadataCid: string
): Promise<Buffer> => {
  const metadataString = await retrieveData(metadataCid);
  if (!metadataString || !isJson(metadataString)) {
    throw new Error("Metadata not found");
  }

  const metadata: Metadata = JSON.parse(metadataString);

  if (metadata.type === "folder") {
    throw new Error("Folder not supported");
  }

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

export const retrieveMetadata = async (
  cid: string
): Promise<Metadata | null> => {
  const metadataString = await retrieveData(`metadata:${cid}`);
  if (!metadataString) {
    return null;
  }
  const metadata: Metadata = JSON.parse(metadataString);

  return metadata;
};
