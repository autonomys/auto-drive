import {
  cidOfNode,
  cidToString,
  folderMetadata,
  OffchainFileMetadata,
  OffchainFolderMetadata,
  OffchainMetadata,
  stringToCid,
} from "@autonomys/auto-drive";
import { PBNode } from "@ipld/dag-pb";
import PizZip from "pizzip";
import { User } from "../../models/users/index.js";
import { FolderTree } from "../../models/objects/folderTree.js";
import {
  NodesUseCases,
  ObjectUseCases,
  OwnershipUseCases,
  UsersUseCases,
} from "../index.js";
import { InteractionType } from "../../models/objects/interactions.js";

const processFile = async (
  data: Buffer,
  filename?: string,
  mimeType?: string
): Promise<{
  cid: string;
  nodesByCid: { [headCid: string]: PBNode[] };
  metadata: OffchainFileMetadata[];
}> => {
  throw new Error("Not implemented");
};

const processTree = async (
  folderTree: FolderTree,
  files: Express.Multer.File[]
): Promise<{
  cid: string;
  nodesByCid: { [headCid: string]: PBNode[] };
  metadata: OffchainMetadata[];
}> => {
  throw new Error("Not implemented");
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

  const pendingCredits = await UsersUseCases.getPendingCreditsByUserAndType(
    reader,
    InteractionType.Download
  );

  if (pendingCredits < metadata.totalSize) {
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
  await UsersUseCases.registerInteraction(
    reader,
    InteractionType.Download,
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
  const pendingCredits = await UsersUseCases.getPendingCreditsByUserAndType(
    user,
    InteractionType.Upload
  );
  if (pendingCredits < data.length) {
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

  await UsersUseCases.registerInteraction(
    user,
    InteractionType.Upload,
    data.length
  );

  return rootCid;
};

const uploadTree = async (
  user: User,
  folderTree: FolderTree,
  files: Express.Multer.File[]
): Promise<string> => {
  throw new Error("Not implemented");
};

export const FilesUseCases = {
  uploadFile,
  uploadTree,
  downloadObject,
};
