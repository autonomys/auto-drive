import { OffchainMetadata } from "@autonomys/auto-drive";
import { User } from "../models/index.js";
import { ObjectInformation } from "../models/object.js";
import { metadataRepository } from "../repositories/index.js";
import { OwnershipUseCases } from "./ownership.js";
import { UploadStatusUseCases } from "./uploadStatus.js";

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
      filter.user.provider,
      filter.user.id
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
    return metadataRepository.getRootObjectsByUser(
      filter.user.provider,
      filter.user.id
    );
  }

  return metadataRepository.getRootObjects();
};

const getObjectInformation = async (
  cid: string
): Promise<ObjectInformation | undefined> => {
  const metadata = await getMetadata(cid);
  if (!metadata) {
    return undefined;
  }

  const uploadStatus = await UploadStatusUseCases.getUploadStatus(cid);

  return { cid, metadata, uploadStatus };
};

const shareObject = async (cid: string, user: User) => {
  const admins = await OwnershipUseCases.getAdmins(cid);
  if (
    admins.find(
      (admin) =>
        admin.oauth_provider === user.provider &&
        admin.oauth_user_id === user.id
    )
  ) {
    return;
  }

  await OwnershipUseCases.setUserAsOwner(user, cid);
};

export const ObjectUseCases = {
  getMetadata,
  getObjectInformation,
  saveMetadata,
  searchMetadataByCID,
  getAllMetadata,
  getRootObjects,
  shareObject,
};
