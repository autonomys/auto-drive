import { OffchainMetadata } from "@autonomys/auto-drive";
import { User } from "../../models/users/index.js";
import {
  ObjectInformation,
  ObjectSearchResult,
  Owner,
} from "../../models/objects/object.js";
import {
  metadataRepository,
  ownershipRepository,
} from "../../repositories/index.js";
import { UsersUseCases } from "../index.js";
import { OwnershipUseCases } from "./ownership.js";
import { UploadStatusUseCases } from "./uploadStatus.js";
import { MetadataEntry } from "../../repositories/objects/metadata.js";

const getMetadata = async (cid: string) => {
  const entry = await metadataRepository.getMetadata(cid);
  if (!entry) {
    return undefined;
  }

  return entry.metadata;
};

const saveMetadata = async (
  rootCid: string,
  cid: string,
  metadata: OffchainMetadata
) => {
  return metadataRepository.setMetadata(rootCid, cid, metadata);
};

const searchMetadataByCID = async (
  cid: string,
  limit: number = 5,
  filter: { scope: "user"; user: User } | { scope: "global" }
): Promise<MetadataEntry[]> => {
  if (filter.scope === "user") {
    return metadataRepository.searchMetadataByCIDAndUser(
      cid,
      limit,
      filter.user.oauthProvider,
      filter.user.oauthUserId
    );
  }

  return metadataRepository.searchMetadataByCID(cid, limit);
};

const searchMetadataByName = async (
  query: string,
  limit: number = 5,
  filter: { scope: "user"; user: User } | { scope: "global" }
): Promise<MetadataEntry[]> => {
  if (filter.scope === "user") {
    return metadataRepository.searchMetadataByNameAndUser(
      query,
      filter.user.oauthProvider,
      filter.user.oauthUserId,
      limit
    );
  }

  return metadataRepository.searchMetadataByName(query, limit);
};

const searchByCIDOrName = async (
  query: string,
  limit: number = 5,
  filter: { scope: "user"; user: User } | { scope: "global" }
): Promise<ObjectSearchResult[]> => {
  const names = await searchMetadataByName(query, limit, filter);
  if (names.length >= limit) {
    return names.slice(0, limit).map((e) => ({
      cid: e.head_cid,
      name: e.metadata.name!,
    }));
  }

  const cids = await searchMetadataByCID(query, limit - names.length, filter);
  return [...names, ...cids].slice(0, limit).map((e) => ({
    cid: e.head_cid,
    name: e.metadata.name!,
  }));
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

const getSharedRoots = async (user: User) => {
  return metadataRepository.getSharedRootObjectsByUser(
    user.oauthProvider,
    user.oauthUserId
  );
};

const getMarkedAsDeletedRoots = async (user: User) => {
  return metadataRepository.getMarkedAsDeletedRootObjectsByUser(
    user.oauthProvider,
    user.oauthUserId
  );
};

const getObjectInformation = async (
  cid: string
): Promise<ObjectInformation | undefined> => {
  const metadata = await getMetadata(cid);
  if (!metadata) {
    return undefined;
  }

  const uploadStatus = await UploadStatusUseCases.getUploadStatus(cid);
  const owners: Owner[] = await OwnershipUseCases.getOwners(cid);

  return { cid, metadata, uploadStatus, owners };
};

const shareObject = async (executor: User, cid: string, publicId: string) => {
  const admins = await OwnershipUseCases.getAdmins(cid);
  const isUserAdmin = admins.find(
    (admin) =>
      admin.oauth_provider === executor.oauthProvider &&
      admin.oauth_user_id === executor.oauthUserId
  );
  if (!isUserAdmin) {
    throw new Error("User is not an admin of this object");
  }

  const user = await UsersUseCases.getUserByPublicId(publicId);
  if (!user) {
    throw new Error("User not found");
  }

  await OwnershipUseCases.setUserAsOwner(user, cid);
};

const markAsDeleted = async (executor: User, cid: string) => {
  const ownerships = await ownershipRepository.getOwnerships(cid);
  const isUserOwner = ownerships.find(
    (owner) =>
      owner.oauth_provider === executor.oauthProvider &&
      owner.oauth_user_id === executor.oauthUserId
  );

  if (!isUserOwner) {
    throw new Error("User is not an owner of this object");
  }

  await OwnershipUseCases.setObjectAsDeleted(executor, cid);
};

const restoreObject = async (executor: User, cid: string) => {
  const ownerships = await ownershipRepository.getOwnerships(cid);
  const isUserOwner = ownerships.find(
    (owner) =>
      owner.oauth_provider === executor.oauthProvider &&
      owner.oauth_user_id === executor.oauthUserId
  );

  if (!isUserOwner) {
    throw new Error("User is not an owner of this object");
  }

  await OwnershipUseCases.restoreObject(executor, cid);
};

export const ObjectUseCases = {
  getMetadata,
  getObjectInformation,
  saveMetadata,
  searchMetadataByCID,
  searchMetadataByName,
  searchByCIDOrName,
  getAllMetadata,
  getRootObjects,
  getSharedRoots,
  shareObject,
  getMarkedAsDeletedRoots,
  markAsDeleted,
  restoreObject,
};
