import {
  cidOfNode,
  cidToString,
  createFileIPLDDag,
  createFolderIPLDDag,
  createMetadataIPLDDag,
  createMetadataNode,
  fileMetadata,
  folderMetadata,
  OffchainFileMetadata,
  OffchainFolderMetadata,
  OffchainMetadata,
  stringToCid,
} from "@autonomys/auto-drive";
import { PBNode } from "@ipld/dag-pb";
import PizZip from "pizzip";
import { FolderTree, User } from "../models/index.js";
import {
  NodesUseCases,
  ObjectUseCases,
  OwnershipUseCases,
  UsersUseCases,
} from "../useCases/index.js";

const processFile = async (
  data: Buffer,
  filename?: string,
  mimeType?: string
): Promise<{
  cid: string;
  nodesByCid: { [headCid: string]: PBNode[] };
  metadata: OffchainFileMetadata[];
}> => {
  const dag = createFileIPLDDag(data, filename);

  const metadata: OffchainMetadata = fileMetadata(
    dag,
    data.length,
    filename,
    mimeType
  );

  const metadataDag = createMetadataIPLDDag(metadata);
  const metadataNodes = Array.from(metadataDag.nodes.values());
  const chunkNodes = Array.from(dag.nodes.values());

  const nodes = [...metadataNodes, ...chunkNodes];

  console.log("Processed file: ", filename);
  const cid = cidToString(dag.headCID);

  return {
    cid,
    nodesByCid: {
      [cid]: nodes,
    },
    metadata: [metadata],
  };
};

const processTree = async (
  folderTree: FolderTree,
  files: Express.Multer.File[]
): Promise<{
  cid: string;
  nodesByCid: { [headCid: string]: PBNode[] };
  metadata: OffchainMetadata[];
}> => {
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

  const childrenMetadata = parsedChildren.map((e) => e.metadata).flat();

  const { headCID, nodes } = createFolderIPLDDag(
    parsedChildren.map((e) => stringToCid(e.cid)),
    folderTree.name,
    childrenMetadata.reduce((acc, e) => acc + e.totalSize, 0)
  );
  const cid = cidToString(headCID);

  const folderNode = nodes.get(headCID);
  if (!folderNode) {
    throw new Error("Folder node not found");
  }

  const directChildrenMetadata = childrenMetadata.filter((e) =>
    folderNode.Links.some((link) => cidToString(link.Hash) === e.dataCid)
  );

  const chunkNodes = Array.from(nodes.values());

  const metadata: OffchainFolderMetadata = folderMetadata(
    cidToString(cidOfNode(folderNode)),
    directChildrenMetadata.map((e) => ({
      cid: e.dataCid,
      name: e.name,
      type: e.type,
      totalSize: e.totalSize,
    })),
    folderTree.name
  );
  const metadataDag = createMetadataIPLDDag(metadata);
  const metadataNodes = Array.from(metadataDag.nodes.values());

  return {
    cid,
    nodesByCid: {
      [cid]: [...metadataNodes, ...chunkNodes],
      ...parsedChildren.reduce((acc, e) => ({ ...acc, ...e.nodesByCid }), {}),
    },
    metadata: [metadata, ...childrenMetadata],
  };
};

const retrieveAndReassembleFile = async (
  metadata: OffchainFileMetadata
): Promise<Buffer | undefined> => {
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

const retrieveAndReassembleFolderAsZip = async (
  reader: User,
  parent: PizZip,
  cid: string
): Promise<PizZip> => {
  const metadata = await ObjectUseCases.getMetadata(cid);
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
        const data = await downloadObject(reader, e.cid);
        if (!data) {
          throw new Error(`Data with CID ${e.cid} not found`);
        }

        return folder.file(e.name!, data);
      }),
    ...metadata.children
      .filter((e) => e.type === "folder")
      .map(async (e) => {
        return retrieveAndReassembleFolderAsZip(reader, folder, e.cid);
      }),
  ]);

  return folder;
};

const downloadObject = async (
  reader: User,
  cid: string
): Promise<Buffer | undefined> => {
  const metadata = await ObjectUseCases.getMetadata(cid);
  if (!metadata) {
    throw new Error(`Metadata with CID ${cid} not found`);
  }

  const credits = await UsersUseCases.getCreditsForUser(reader);
  if (credits.downloadCredits < metadata.totalSize) {
    throw new Error("Not enough download credits");
  }

  if (metadata.type === "folder") {
    const zip = await retrieveAndReassembleFolderAsZip(
      reader,
      new PizZip(),
      cid
    );
    return zip.generate({
      type: "nodebuffer",
    });
  }

  const data = await retrieveAndReassembleFile(metadata);
  await UsersUseCases.subtractDownloadCreditsFromUser(
    reader,
    metadata.totalSize
  );

  return data;
};

const uploadFile = async (
  user: User,
  data: Buffer,
  filename?: string,
  mimeType?: string
): Promise<string> => {
  const credits = await UsersUseCases.getCreditsForUser(user);
  if (credits.uploadCredits < data.length) {
    throw new Error("Not enough upload credits");
  }

  const {
    cid: rootCid,
    nodesByCid,
    metadata,
  } = await processFile(data, filename, mimeType);

  await Promise.all(
    Object.keys(nodesByCid).map((cid) => {
      NodesUseCases.saveNodes(rootCid, cid, nodesByCid[cid]);
    })
  );
  await OwnershipUseCases.setUserAsAdmin(user, rootCid);
  await Promise.all(
    metadata.map((e) => ObjectUseCases.saveMetadata(rootCid, e.dataCid, e))
  );

  await UsersUseCases.subtractUploadCreditsFromUser(user, data.length);

  return rootCid;
};

const uploadTree = async (
  user: User,
  folderTree: FolderTree,
  files: Express.Multer.File[]
): Promise<string> => {
  const {
    cid: rootCid,
    nodesByCid,
    metadata,
  } = await processTree(folderTree, files);

  const credits = await UsersUseCases.getCreditsForUser(user);
  const rootMetadata = metadata.find((e) => e.dataCid === rootCid);
  if (!rootMetadata) {
    throw new Error(`Root metadata with CID ${rootCid} not found`);
  }
  if (credits.uploadCredits < rootMetadata.totalSize) {
    throw new Error("Not enough upload credits");
  }

  await Promise.all(
    Object.keys(nodesByCid).map((cid) => {
      NodesUseCases.saveNodes(rootCid, cid, nodesByCid[cid]);
    })
  );
  await OwnershipUseCases.setUserAsAdmin(user, rootCid);
  await Promise.all(
    metadata.map((e) => ObjectUseCases.saveMetadata(rootCid, e.dataCid, e))
  );

  await UsersUseCases.subtractUploadCreditsFromUser(
    user,
    rootMetadata.totalSize
  );

  return rootCid;
};

export const FilesUseCases = {
  uploadFile,
  uploadTree,
  downloadObject,
};
