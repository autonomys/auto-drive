import { OffchainMetadata } from "@autonomys/auto-drive";
import { metadataRepository } from "../repositories/metadata.js";

const getMetadata = async (cid: string) => {
  const entry = await metadataRepository.getMetadata(cid);
  if (!entry) {
    return undefined;
  }

  return entry.metadata;
};

const saveMetadata = async (cid: string, metadata: OffchainMetadata) => {
  return metadataRepository.setMetadata(cid, metadata);
};

const searchMetadataByCID = async (cid: string, limit: number = 5) => {
  return metadataRepository
    .searchMetadataByCID(cid, limit)
    .then((result) => result.map((entry) => entry.cid));
};

const getAllMetadata = async () => {
  return metadataRepository
    .getAllMetadata()
    .then((metadata) => metadata.map((entry) => entry.metadata));
};

export const MetadataUseCases = {
  getMetadata,
  saveMetadata,
  searchMetadataByCID,
  getAllMetadata,
};
