import {
  ChunkInfo,
  cidToString,
  MetadataType,
  processFolderToIPLDFormat,
  stringToCid,
} from "@autonomys/auto-drive";
import { blockstoreRepository } from "../../repositories/uploads/index.js";
import { CID } from "multiformats";
import { FolderUpload, UploadStatus } from "../../models/uploads/upload.js";
import { UploadsUseCases } from "./uploads.js";
import { FolderTree } from "../../models/objects/index.js";
import { getUploadBlockstore } from "../../services/uploadProcessorCache/index.js";
import { uploadsRepository } from "../../repositories/uploads/uploads.js";

const getFileUploadIdCID = async (uploadId: string): Promise<CID> => {
  const blockstoreEntry = await blockstoreRepository.getByType(
    uploadId,
    MetadataType.File
  );
  if (blockstoreEntry.length !== 1) {
    throw new Error("Invalid number of blockstore entries");
  }
  const cid = blockstoreEntry[0].cid;

  return stringToCid(cid);
};

const getFolderUploadIdCID = async (uploadId: string): Promise<CID> => {
  const blockstoreEntry = await blockstoreRepository.getByType(
    uploadId,
    MetadataType.Folder
  );
  if (blockstoreEntry.length !== 1) {
    throw new Error("Invalid number of blockstore entries");
  }
  const cid = blockstoreEntry[0].cid;

  return stringToCid(cid);
};

const getChunksByNodeType = async (
  uploadId: string,
  nodeType: MetadataType
): Promise<ChunkInfo[]> => {
  const blockstoreEntries =
    await blockstoreRepository.getBlockstoreEntriesWithoutData(uploadId);

  return blockstoreEntries
    .filter((e) => e.node_type === nodeType)
    .map((block) => ({
      size: block.node_size,
      cid: block.cid,
    }));
};

const processFileTree = async (
  rootUploadId: string,
  fileTree: FolderTree
): Promise<CID> => {
  if (fileTree.type === "file") {
    const childUploadId = await uploadsRepository.getUploadEntriesByRelativeId(
      rootUploadId,
      fileTree.id
    );
    if (!childUploadId) {
      throw new Error("Child upload not found");
    }

    const fileUpload = await BlockstoreUseCases.getFileUploadIdCID(
      childUploadId.id
    );
    return fileUpload;
  }

  const upload = await UploadsUseCases.createSubFolderUpload(
    rootUploadId,
    fileTree
  );
  const blockstore = await getUploadBlockstore(upload.id);

  const childrenCids = await Promise.all(
    fileTree.children.map((child) => processFileTree(rootUploadId, child))
  );

  const childrenNodesLengths = await Promise.all(
    childrenCids.map((cid) =>
      blockstoreRepository
        .getByCid(rootUploadId, cidToString(cid))
        .then((e) => e?.node_size ?? 0)
    )
  );

  const totalSize = childrenNodesLengths.reduce((acc, curr) => acc + curr, 0);

  return processFolderToIPLDFormat(
    blockstore,
    childrenCids,
    fileTree.name,
    totalSize
  );
};

const processFolderUpload = async (upload: FolderUpload): Promise<void> => {
  const files = await UploadsUseCases.getFileFromFolderUpload(upload.id);
  const allCompleted = files.every((f) => f.status === UploadStatus.COMPLETED);
  if (!allCompleted) {
    throw new Error("Not all files are completed");
  }

  const fileTree = upload.fileTree;
  await processFileTree(upload.id, fileTree);
};

export const BlockstoreUseCases = {
  getFileUploadIdCID,
  getFolderUploadIdCID,
  getChunksByNodeType,
  processFolderUpload,
};
