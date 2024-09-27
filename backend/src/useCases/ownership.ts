import { User } from "../models/index.js";
import { ownershipRepository } from "../repositories/index.js";

const setUserAsOwner = async (user: User, cid: string) => {
  await ownershipRepository.setUserAsOwner(cid, user.email);
};

const setUserAsAdmin = async (user: User, cid: string) => {
  await ownershipRepository.setUserAsAdmin(cid, user.email);
};

const setObjectAsDeleted = async (user: User, cid: string) => {
  await ownershipRepository.setObjectAsDeleted(user.email, cid);
};

export const OwnershipUseCases = {
  setUserAsOwner,
  setUserAsAdmin,
  setObjectAsDeleted,
};
