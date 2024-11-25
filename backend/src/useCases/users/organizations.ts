import { v4 } from 'uuid'
import { User } from '../../models/users/index.js'
import { Organization } from '../../models/users/organization.js'
import { organizationMembersRepository } from '../../repositories/users/organizationMembers.js'
import { organizationsRepository } from '../../repositories/users/organizations.js'
import { SubscriptionsUseCases } from './subscriptions.js'

const getOrganizationByUser = async (user: User): Promise<Organization> => {
  const organizationMemberships =
    await organizationMembersRepository.getOrganizationMembershipsByUser(
      user.oauthProvider,
      user.oauthUserId,
    )

  const organizationId =
    organizationMemberships.length > 0
      ? organizationMemberships[0].organization_id
      : null

  if (!organizationId) {
    throw new Error(
      `User is not a member of any organization: (${user.oauthProvider}, ${user.oauthUserId})`,
    )
  }

  const organization =
    await organizationsRepository.getOrganizationById(organizationId)

  if (!organization) {
    throw new Error('Organization not found')
  }

  return { id: organization.id, name: organization.name }
}

const initOrganization = async (user: User) => {
  const organization = await organizationsRepository.createOrganization(
    v4(),
    user.publicId ?? user.oauthUserId,
  )

  await organizationMembersRepository.addMemberToOrganization(
    organization.id,
    user.oauthProvider,
    user.oauthUserId,
  )
  await SubscriptionsUseCases.initSubscription(organization.id)
}

export const OrganizationsUseCases = {
  getOrganizationByUser,
  initOrganization,
}
