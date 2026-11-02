import pg from 'pg'
import { v4 } from 'uuid'
import { User, Organization, OrganizationWithMembers } from '@auto-drive/models'
import {
  organizationMembersRepository,
  organizationsRepository,
} from '../repositories/index.js'
import { deriveUserPublicId } from './users.js'

const getOrganizationByUser = async (user: User): Promise<Organization> => {
  const membership =
    await organizationMembersRepository.getOrganizationMembershipByUser(
      user.oauthProvider,
      user.oauthUserId,
    )

  if (!membership) {
    throw new Error(
      `User is not a member of any organization: (${user.oauthProvider}, ${user.oauthUserId})`,
    )
  }

  const organization = await organizationsRepository.getOrganizationById(
    membership.organization_id,
  )

  if (!organization) {
    throw new Error('Organization not found')
  }

  return { id: organization.id, name: organization.name }
}

// Every user starts in a personal organisation of their own. Its name is not
// shown anywhere, so it carries no identifier of the user.
const initOrganization = async (user: User, db: pg.Client) => {
  const organization = await organizationsRepository.createOrganization(
    v4(),
    'Personal',
    db,
  )

  await organizationMembersRepository.addMemberToOrganization(
    organization.id,
    user.oauthProvider,
    user.oauthUserId,
    db,
  )
}

const getOrganization = async (
  organizationId: string,
): Promise<OrganizationWithMembers> => {
  const organization =
    await organizationsRepository.getOrganizationById(organizationId)

  if (!organization) {
    throw new Error('Organization not found')
  }

  const members =
    await organizationMembersRepository.getOrganizationMemberships(
      organizationId,
    )

  return {
    id: organization.id,
    name: organization.name,
    members: members.map((member) =>
      deriveUserPublicId(member.oauth_provider, member.oauth_user_id),
    ),
  }
}
export const OrganizationsUseCases = {
  getOrganizationByUser,
  initOrganization,
  getOrganization,
}
