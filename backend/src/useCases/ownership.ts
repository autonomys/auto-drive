import { User } from "../models/user";
import { OwnershipRepository } from "../repositories/ownership";

const setUserAsOwner = async (user: User, cid: string) => {
  await OwnershipRepository.setUserAsOwner(cid, user.email);
};

const setUserAsAdmin = async (user: User, cid: string) => {
  await OwnershipRepository.setUserAsAdmin(cid, user.email);
};

const setObjectAsDeleted = async (user: User, cid: string) => {
  await OwnershipRepository.setObjectAsDeleted(user.email, cid);
};

export const OwnershipUseCases = {
  setUserAsOwner,
  setUserAsAdmin,
  setObjectAsDeleted,
};
