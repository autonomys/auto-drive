import {
  storeData,
  retrieveNodeData,
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
  createFileIPLDDag,
  stringToCid,
  fileMetadata,
  OffchainMetadata,
  createMetadataNode,
  encodeNode,
  OffchainFolderMetadata,
  folderMetadata,
  createFolderIPLDDag,
} from "@autonomys/auto-drive";
import { encode, PBNode } from "@ipld/dag-pb";
import { FolderTree } from "../../models/folderTree.js";
import { retrieveChunkData } from "../../api/api.js";

dotenv.config();

const transactionManager = createTransactionManager(
  process.env.RPC_ENDPOINT || "ws://localhost:9944"
);

const storeMetadata = async (metadata: OffchainMetadata): Promise<string> => {
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
  const dag = createFileIPLDDag(data, filename);

  const metadata: OffchainMetadata = fileMetadata(
    dag,
    data.length,
    filename,
    mimeType
  );

  const metadataPbFormatted = encodeNode(createMetadataNode(metadata));

  const chunkNodes = Array.from(dag.nodes.values());

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

  const childrenMetadata = await Promise.all(
    cids.map((e) =>
      retrieveMetadata(e).then((e) => ({
        type: e!.type,
        name: e!.name,
        cid: e!.dataCid,
        totalSize: e!.totalSize,
      }))
    )
  );

  const { headCID, nodes } = createFolderIPLDDag(
    cids.map((e) => stringToCid(e)),
    folderTree.name,
    childrenMetadata.reduce((acc, e) => acc + e.totalSize, 0)
  );
  const cid = cidToString(headCID);

  const folderNode = nodes.get(headCID);
  if (!folderNode) {
    throw new Error("Folder node not found");
  }

  const chunkNodes = Array.from(nodes.values());

  const metadata: OffchainFolderMetadata = folderMetadata(
    cidToString(cidOfNode(folderNode)),
    childrenMetadata
  );
  const metadataPbFormatted = encodeNode(createMetadataNode(metadata));

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
    ...chunkNodes
      .map((e) => Buffer.from(encode(e)))
      .map((chunk) => ({
        module: "system",
        method: "remarkWithEvent",
        params: [chunk.toString("base64")],
      })),
  ];

  const transactionResults = await transactionManager.submit(transactions);

  await storeMetadata(metadata);
  await Promise.all(
    chunkNodes.map((e) =>
      storeData(cidToString(cidOfNode(e)), encodeNode(e).toString("base64"))
    )
  );
  await storeData(cid, encodeNode(folderNode).toString("base64"));

  return { cid, transactionResults };
};

export const retrieveAndReassembleData = async (
  metadataCid: string
): Promise<Buffer | undefined> => {
  const metadataString = await retrieveNodeData(metadataCid);
  if (!metadataString || !isJson(metadataString)) {
    throw new Error("Metadata not found");
  }

  const metadata: OffchainMetadata = JSON.parse(metadataString);

  if (metadata.type === "folder") {
    throw new Error("Folder not supported");
  }

  if (metadata.totalChunks === 1) {
    return retrieveChunkData(metadata.chunks[0].cid);
  }

  const chunks: Buffer[] = await Promise.all(
    metadata.chunks.map(async (chunk) => {
      const chunkData = await retrieveChunkData(chunk.cid);
      if (!chunkData) {
        throw new Error(`Chunk with CID ${chunk.cid} not found`);
      }
      return chunkData;
    })
  );

  return Buffer.concat(chunks);
};

export const retrieveMetadata = async (
  cid: string
): Promise<OffchainMetadata | null> => {
  const metadataString = await retrieveNodeData(`metadata:${cid}`);

  if (!metadataString) {
    return null;
  }
  const metadata: OffchainMetadata = JSON.parse(metadataString);

  return metadata;
};
