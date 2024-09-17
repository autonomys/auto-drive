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
  MetadataType,
  IPLDNodeData,
} from "@autonomys/auto-drive";
import { encode } from "@ipld/dag-pb";
import { FolderTree } from "../../models/folderTree.js";
import {
  getChunkData,
  saveNodesWithHeadCID,
  setNode,
} from "../../api/nodes.js";
import { getMetadata, saveMetadata } from "../../api/metadata.js";
import { setTransactionResults } from "../../api/transactionResults.js";

dotenv.config();

const transactionManager = createTransactionManager(
  process.env.RPC_ENDPOINT || "ws://localhost:9944"
);

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

  await saveMetadata(cidToString(dag.headCID), metadata);
  await saveNodesWithHeadCID(chunkNodes, dag.headCID);

  await setTransactionResults(cidToString(dag.headCID), results);

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
      getMetadata(e).then((e) => ({
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

  await saveMetadata(cidToString(headCID), metadata);
  await Promise.all(
    chunkNodes.map((e) =>
      setNode(
        cidToString(headCID),
        cidToString(cidOfNode(e)),
        IPLDNodeData.decode(e.Data!).type,
        encodeNode(e).toString("base64")
      )
    )
  );

  await setTransactionResults(cidToString(headCID), transactionResults);

  await setNode(
    cidToString(headCID),
    cidToString(cidOfNode(folderNode)),
    MetadataType.Folder,
    encodeNode(folderNode).toString("base64")
  );

  return { cid, transactionResults };
};

export const retrieveAndReassembleData = async (
  metadataCid: string
): Promise<Buffer | undefined> => {
  const metadata = await getMetadata(metadataCid);

  if (!metadata) {
    throw new Error(`Metadata with CID ${metadataCid} not found`);
  }

  if (metadata.type === "folder") {
    throw new Error("Folder not supported");
  }

  if (metadata.totalChunks === 1) {
    return getChunkData(metadata.chunks[0].cid);
  }

  const chunks: Buffer[] = await Promise.all(
    metadata.chunks.map(async (chunk) => {
      const chunkData = await getChunkData(chunk.cid);
      if (!chunkData) {
        throw new Error(`Chunk with CID ${chunk.cid} not found`);
      }
      return chunkData;
    })
  );

  return Buffer.concat(chunks);
};
