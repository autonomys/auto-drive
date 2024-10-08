import { OffchainMetadata } from "@autonomys/auto-drive";
import { OAuthUser, User } from "../models/index.js";
import { ObjectInformation } from "../models/object.js";
import { metadataRepository } from "../repositories/index.js";
import { UsersUseCases } from "./index.js";
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
      filter.user.oauthProvider,
      filter.user.oauthUserId
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
      filter.user.oauthProvider,
      filter.user.oauthUserId
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

const shareObject = async (executor: User, cid: string, handle: string) => {
  const admins = await OwnershipUseCases.getAdmins(cid);
  const isUserAdmin = admins.find(
    (admin) =>
      admin.oauth_provider === executor.oauthProvider &&
      admin.oauth_user_id === executor.oauthUserId
  );
  if (!isUserAdmin) {
    throw new Error("User is not an admin of this object");
  }

  const user = await UsersUseCases.getUserByHandle(handle);
  if (!user) {
    throw new Error("User not found");
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
