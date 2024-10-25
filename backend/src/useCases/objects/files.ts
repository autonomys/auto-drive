import {
  fileMetadata,
  folderMetadata,
  MetadataType,
  OffchainFileMetadata,
} from "@autonomys/auto-drive";
import PizZip from "pizzip";
import { User } from "../../models/users/index.js";
import {
  NodesUseCases,
  ObjectUseCases,
  OwnershipUseCases,
  UsersUseCases,
} from "../index.js";
import { InteractionType } from "../../models/objects/interactions.js";
import { uploadsRepository } from "../../repositories/uploads/uploads.js";
import {
  FileArtifacts,
  FolderArtifacts,
  UploadArtifacts,
  UploadType,
} from "../../models/uploads/upload.js";
import { BlockstoreUseCases } from "../uploads/blockstore.js";

const generateFileArtifacts = async (
  uploadId: string
): Promise<FileArtifacts> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId);
  if (!upload) {
    throw new Error("Upload not found");
  }
  if (upload.type !== UploadType.FILE) {
    throw new Error("Upload is not a file");
  }

  const cid = await BlockstoreUseCases.getFileUploadIdCID(uploadId);

  let chunks = await BlockstoreUseCases.getChunksByNodeType(
    uploadId,
    MetadataType.FileChunk
  );
  if (chunks.length === 0) {
    chunks = await BlockstoreUseCases.getChunksByNodeType(
      uploadId,
      MetadataType.File
    );
  }

  const totalSize = chunks.reduce((acc, e) => acc + Number(e.size), 0);

  const metadata = fileMetadata(
    cid,
    chunks,
    totalSize,
    upload.name,
    upload.mime_type
  );

  return {
    metadata,
  };
};

const generateFolderArtifacts = async (
  uploadId: string
): Promise<FolderArtifacts> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId);
  if (!upload) {
    throw new Error("Upload not found");
  }
  if (upload.type !== UploadType.FOLDER) {
    throw new Error("Upload is not a folder");
  }
  if (!upload.file_tree) {
    throw new Error("Upload has no file tree");
  }

  const childrenUploads = await Promise.all(
    upload.file_tree.children.map((e) =>
      uploadsRepository
        .getUploadEntriesByRelativeId(upload.root_upload_id, e.id)
        .then((upload) => {
          if (!upload) {
            throw new Error(`Upload with relative ID ${e.id} not found`);
          }
          return upload;
        })
    )
  );

  const folderCID = await BlockstoreUseCases.getUploadCID(uploadId);

  const childrenArtifacts = await Promise.all(
    childrenUploads.map((e) => generateArtifacts(e.id))
  );

  const childrenMetadata = childrenArtifacts.map((e) => ({
    cid: e.metadata.dataCid,
    name: e.metadata.name,
    type: e.metadata.type,
    totalSize: e.metadata.totalSize,
  }));

  const metadata = folderMetadata(folderCID, childrenMetadata, upload.name);

  return {
    metadata,
    childrenArtifacts,
  };
};

const generateArtifacts = async (
  uploadId: string
): Promise<UploadArtifacts> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId);
  if (!upload) {
    throw new Error("Upload not found");
  }
  return upload.type === UploadType.FILE
    ? generateFileArtifacts(uploadId)
    : generateFolderArtifacts(uploadId);
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

const handleFileUploadFinalization = async (
  user: User,
  uploadId: string
): Promise<string> => {
  const pendingCredits = await UsersUseCases.getPendingCreditsByUserAndType(
    user,
    InteractionType.Upload
  );
  const { metadata } = await generateFileArtifacts(uploadId);
  if (pendingCredits < metadata.totalSize) {
    throw new Error("Not enough upload credits");
  }

  await OwnershipUseCases.setUserAsAdmin(user, metadata.dataCid);
  await ObjectUseCases.saveMetadata(
    metadata.dataCid,
    metadata.dataCid,
    metadata
  );

  await UsersUseCases.registerInteraction(
    user,
    InteractionType.Upload,
    metadata.totalSize
  );

  return metadata.dataCid;
};

const handleFolderUploadFinalization = async (
  user: User,
  uploadId: string
): Promise<string> => {
  console.time("generateFolderArtifacts");
  const { metadata, childrenArtifacts } = await generateFolderArtifacts(
    uploadId
  );
  console.timeEnd("generateFolderArtifacts");

  const fullMetadata = [metadata, ...childrenArtifacts.map((e) => e.metadata)];
  await Promise.all(
    fullMetadata.map((childMetadata) =>
      ObjectUseCases.saveMetadata(
        metadata.dataCid,
        childMetadata.dataCid,
        childMetadata
      )
    )
  );

  await OwnershipUseCases.setUserAsAdmin(user, metadata.dataCid);

  return metadata.dataCid;
};

export const FilesUseCases = {
  handleFileUploadFinalization,
  handleFolderUploadFinalization,
  downloadObject,
};
