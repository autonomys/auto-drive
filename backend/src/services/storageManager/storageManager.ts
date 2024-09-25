import dotenv from "dotenv";
import {
  cidOfNode,
  cidToString,
  createFileIPLDDag,
  stringToCid,
  fileMetadata,
  OffchainMetadata,
  createMetadataNode,
  OffchainFolderMetadata,
  folderMetadata,
  createFolderIPLDDag,
} from "@autonomys/auto-drive";
import { PBNode } from "@ipld/dag-pb";
import { FolderTree } from "../../models/folderTree.js";
import { getChunkData, saveNodesWithHeadCID } from "../../api/nodes.js";
import { getMetadata, saveMetadata } from "../../api/metadata.js";

dotenv.config();

export const processFile = async (
  data: Buffer,
  filename?: string,
  mimeType?: string,
): Promise<{ cid: string; nodes: PBNode[] }> => {
  const dag = createFileIPLDDag(data, filename);

  const metadata: OffchainMetadata = fileMetadata(
    dag,
    data.length,
    filename,
    mimeType,
  );

  const metadataNode = createMetadataNode(metadata);
  const chunkNodes = Array.from(dag.nodes.values());

  const nodes = [metadataNode, ...chunkNodes];

  await saveMetadata(cidToString(dag.headCID), metadata);
  await saveNodesWithHeadCID(chunkNodes, dag.headCID);

  console.log("Processed file: ", filename);

  return {
    cid: cidToString(dag.headCID),
    nodes,
  };
};

export const processTree = async (
  folderTree: FolderTree,
  files: Express.Multer.File[],
): Promise<{ cid: string; nodes: PBNode[] }> => {
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
      })),
    ),
  );

  const { headCID, nodes } = createFolderIPLDDag(
    cids.map((e) => stringToCid(e)),
    folderTree.name,
    childrenMetadata.reduce((acc, e) => acc + e.totalSize, 0),
  );
  const cid = cidToString(headCID);

  const folderNode = nodes.get(headCID);
  if (!folderNode) {
    throw new Error("Folder node not found");
  }

  const chunkNodes = Array.from(nodes.values());

  const metadata: OffchainFolderMetadata = folderMetadata(
    cidToString(cidOfNode(folderNode)),
    childrenMetadata,
    folderTree.name,
  );
  const metadataNode = createMetadataNode(metadata);

  await saveMetadata(cidToString(headCID), metadata);

  return {
    cid,
    nodes: [
      metadataNode,
      ...parsedChildren.map((e) => e.nodes).flat(),
      ...chunkNodes,
    ],
  };
};

export const retrieveAndReassembleData = async (
  metadataCid: string,
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
    }),
  );

  return Buffer.concat(chunks);
};

export const uploadFile = async (
  data: Buffer,
  filename?: string,
  mimeType?: string,
): Promise<string> => {
  const { cid, nodes } = await processFile(data, filename, mimeType);

  await saveNodesWithHeadCID(nodes, cid);

  return cid;
};

export const uploadTree = async (
  folderTree: FolderTree,
  files: Express.Multer.File[],
): Promise<string> => {
  const { cid, nodes } = await processTree(folderTree, files);

  await saveNodesWithHeadCID(nodes, cid);

  return cid;
};
