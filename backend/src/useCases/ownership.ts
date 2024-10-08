import { Owner, OwnerRole, User } from "../models/index.js";
import { ownershipRepository, usersRepository } from "../repositories/index.js";

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

const getOwners = async (cid: string): Promise<Owner[]> => {
  const ownerships = await ownershipRepository.getOwnerships(cid);
  const users = await Promise.all(
    ownerships.map((e) =>
      usersRepository.getUserByOAuthInformation(
        e.oauth_provider,
        e.oauth_user_id
      )
    )
  );

  if (users.some((user) => !user)) {
    console.log("users", users);

    throw new Error("Inconsistent database state");
  }

  const safeUsers = users.map((user) => user!);

  return safeUsers.map((user, index) => ({
    handle: user.handle,
    role: ownerships[index].is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
  }));
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
