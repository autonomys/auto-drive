import { v4 } from "uuid";
import { User } from "../models/index";
import { Organization } from "../models/index";
import { organizationMembersRepository } from "../repositories/index";
import { organizationsRepository } from "../repositories/index";

const getOrganizationByUser = async (user: User): Promise<Organization> => {
  const organizationMemberships =
    await organizationMembersRepository.getOrganizationMembershipsByUser(
      user.oauthProvider,
      user.oauthUserId
    );

  const organizationId =
    organizationMemberships.length > 0
      ? organizationMemberships[0].organization_id
      : null;

  if (!organizationId) {
    throw new Error(
      `User is not a member of any organization: (${user.oauthProvider}, ${user.oauthUserId})`
    );
  }

  const organization = await organizationsRepository.getOrganizationById(
    organizationId
  );

  if (!organization) {
    throw new Error("Organization not found");
  }

  return { id: organization.id, name: organization.name };
};

const initOrganization = async (user: User) => {
  const organization = await organizationsRepository.createOrganization(
    v4(),
    user.publicId ?? user.oauthUserId
  );

  await organizationMembersRepository.addMemberToOrganization(
    organization.id,
    user.oauthProvider,
    user.oauthUserId
  );
};

export const OrganizationsUseCases = {
  getOrganizationByUser,
  initOrganization,
};
