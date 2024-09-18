import { OffchainMetadata } from "@autonomys/auto-drive";
import { metadataRepository } from "../repositories/metadata.js";

export const getMetadata = async (cid: string) => {
  const entry = await metadataRepository.getMetadata(cid);
  if (!entry) {
    return undefined;
  }

  return entry.metadata;
};

export const saveMetadata = async (cid: string, metadata: OffchainMetadata) => {
  return metadataRepository.setMetadata(cid, metadata);
};

export const searchMetadataByCID = async (cid: string, limit?: number) => {
  const defaultLimit = 5;
  return metadataRepository
    .searchMetadataByCID(cid, limit ?? defaultLimit)
    .then((result) => result.map((entry) => entry.cid));
};

export const getAllMetadata = async () => {
  return metadataRepository
    .getAllMetadata()
    .then((metadata) => metadata.map((entry) => entry.metadata));
};
