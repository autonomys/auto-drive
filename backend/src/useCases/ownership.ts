import { OAuthUser, User } from "../models/index.js";
import { ownershipRepository } from "../repositories/index.js";

const setUserAsOwner = async (user: User, cid: string) => {
  await ownershipRepository.setUserAsOwner(
    cid,
    user.oauthProvider,
    user.oauthUserId
  );
};

const setUserAsAdmin = async (user: User, cid: string) => {
  await ownershipRepository.setUserAsAdmin(
    cid,
    user.oauthProvider,
    user.oauthUserId
  );
};

const setObjectAsDeleted = async (user: User, cid: string) => {
  await ownershipRepository.setObjectAsDeleted(
    user.oauthProvider,
    user.oauthUserId,
    cid
  );
};

const getOwners = async (cid: string) => {
  return ownershipRepository.getOwnerships(cid);
};

const getAdmins = async (cid: string) => {
  return ownershipRepository.getAdmins(cid);
};

export const OwnershipUseCases = {
  setUserAsOwner,
  setUserAsAdmin,
  setObjectAsDeleted,
  getOwners,
  getAdmins,
};
