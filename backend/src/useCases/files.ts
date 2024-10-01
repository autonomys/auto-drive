import {
  cidOfNode,
  cidToString,
  createFileIPLDDag,
  createFolderIPLDDag,
  createMetadataNode,
  fileMetadata,
  folderMetadata,
  OffchainFolderMetadata,
  OffchainMetadata,
  stringToCid,
} from "@autonomys/auto-drive";
import { PBNode } from "@ipld/dag-pb";
import PizZip from "pizzip";
import { FolderTree } from "../models/index.js";
import { User } from "../models/user.js";
import {
  MetadataUseCases,
  NodesUseCases,
  OwnershipUseCases,
} from "../useCases/index.js";

const processFile = async (
  data: Buffer,
  filename?: string,
  mimeType?: string
): Promise<{ cid: string; nodes: PBNode[] }> => {
  const dag = createFileIPLDDag(data, filename);

  const metadata: OffchainMetadata = fileMetadata(
    dag,
    data.length,
    filename,
    mimeType
  );

  const metadataNode = createMetadataNode(metadata);
  const chunkNodes = Array.from(dag.nodes.values());

  const nodes = [metadataNode, ...chunkNodes];

  await MetadataUseCases.saveMetadata(cidToString(dag.headCID), metadata);
  await NodesUseCases.saveNodesWithHeadCID(chunkNodes, dag.headCID);

  console.log("Processed file: ", filename);

  return {
    cid: cidToString(dag.headCID),
    nodes,
  };
};

const processTree = async (
  folderTree: FolderTree,
  files: Express.Multer.File[]
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
      MetadataUseCases.getMetadata(e).then((e) => ({
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
    childrenMetadata,
    folderTree.name
  );
  const metadataNode = createMetadataNode(metadata);

  await MetadataUseCases.saveMetadata(cidToString(headCID), metadata);

  return {
    cid,
    nodes: [
      metadataNode,
      ...parsedChildren.map((e) => e.nodes).flat(),
      ...chunkNodes,
    ],
  };
};

export const createFolderZip = async (
  parent: PizZip,
  cid: string
): Promise<PizZip> => {
  const metadata = await MetadataUseCases.getMetadata(cid);
  if (!metadata) {
    throw new Error(`Metadata with CID ${cid} not found`);
  }
  if (!metadata.name) {
    throw new Error(`Metadata with CID ${cid} has no name`);
  }

  if (metadata.type !== "folder") {
    throw new Error(`Metadata with CID ${cid} is not a folder`);
  }

  const folder = parent.folder(metadata.name);

  await Promise.all([
    ...metadata.children
      .filter((e) => e.type === "file")
      .map(async (e) => {
        const data = await retrieveAndReassembleData(e.cid);
        if (!data) {
          throw new Error(`Data with CID ${e.cid} not found`);
        }

        return folder.file(e.name!, data);
      }),
    ...metadata.children
      .filter((e) => e.type === "folder")
      .map((e) => createFolderZip(parent, e.cid)),
  ]);

  return folder;
};

const retrieveAndReassembleData = async (
  metadataCid: string
): Promise<Buffer | undefined> => {
  const metadata = await MetadataUseCases.getMetadata(metadataCid);

  if (!metadata) {
    throw new Error(`Metadata with CID ${metadataCid} not found`);
  }

  if (metadata.type === "folder") {
    const zip = await createFolderZip(new PizZip(), metadataCid);
    return zip.generate({
      type: "nodebuffer",
    });
  }

  if (metadata.totalChunks === 1) {
    return NodesUseCases.getChunkData(metadata.chunks[0].cid);
  }

  const chunks: Buffer[] = await Promise.all(
    metadata.chunks
      .filter((e) => e.cid !== metadata.dataCid)
      .map(async (chunk) => {
        const chunkData = await NodesUseCases.getChunkData(chunk.cid);
        if (!chunkData) {
          throw new Error(`Chunk with CID ${chunk.cid} not found`);
        }
        return chunkData;
      })
  );

  return Buffer.concat(chunks);
};

const uploadFile = async (
  user: User,
  data: Buffer,
  filename?: string,
  mimeType?: string
): Promise<string> => {
  const { cid, nodes } = await processFile(data, filename, mimeType);

  await NodesUseCases.saveNodesWithHeadCID(nodes, cid);
  await OwnershipUseCases.setUserAsOwner(user, cid);

  return cid;
};

const uploadTree = async (
  user: User,
  folderTree: FolderTree,
  files: Express.Multer.File[]
): Promise<string> => {
  const { cid, nodes } = await processTree(folderTree, files);

  await NodesUseCases.saveNodesWithHeadCID(nodes, cid);
  await OwnershipUseCases.setUserAsOwner(user, cid);

  return cid;
};

export const FilesUseCases = {
  uploadFile,
  uploadTree,
  retrieveAndReassembleData,
};
