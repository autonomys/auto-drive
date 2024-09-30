import { OffchainMetadata } from "@autonomys/auto-drive";
import { User } from "../models/index.js";
import { metadataRepository } from "../repositories/index.js";

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

const searchMetadataByCID = async (
  cid: string,
  limit: number = 5,
  filter: { scope: "user"; user: User } | { scope: "global" }
) => {
  if (filter.scope === "user") {
    return metadataRepository.searchMetadataByCIDAndUser(
      cid,
      limit,
      filter.user.email
    );
  }

  return metadataRepository
    .searchMetadataByCID(cid, limit)
    .then((e) => e.map((e) => e.cid));
};

const getAllMetadata = async () => {
  return metadataRepository
    .getAllMetadata()
    .then((metadata) => metadata.map((entry) => entry.metadata));
};

const getRootObjects = async (
  filter: { scope: "user"; user: User } | { scope: "global" }
) => {
  if (filter.scope === "user") {
    return metadataRepository.getRootObjectsByUser(filter.user.email);
  }

  return metadataRepository.getRootObjects();
};

export const MetadataUseCases = {
  getMetadata,
  saveMetadata,
  searchMetadataByCID,
  getAllMetadata,
  getRootObjects,
};
