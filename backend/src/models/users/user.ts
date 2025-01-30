import { Organization } from './organization'

export type OAuthUser = {
  provider: string
  id: string
  email?: string
}

export enum UserRole {
  User = 'User',
  Admin = 'Admin',
}

export type PublicId = string | null

export type UserOrPublicId = User | PublicId

type UserBase = {
  oauthProvider: string
  oauthUserId: string
  role: UserRole
  publicId: PublicId
}

export type OnboardedUser = UserBase & {
  publicId: string
  onboarded: true
}

export type User = OnboardedUser

export type UserWithOrganization = User & {
  organizationId: Organization['id']
}
