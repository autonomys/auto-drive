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

export const getAllMetadata = async () => {
  return metadataRepository
    .getAllMetadata()
    .then((metadata) => metadata.map((entry) => entry.metadata));
};
