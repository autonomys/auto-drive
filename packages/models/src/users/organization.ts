import { ApiKeyWithoutSecret } from "./apiKey";

export type Organization = {
  id: string;
  name: string;
};

/**
 * Organisation admins manage the organisation (its API keys, #889); members
 * use its account. Both see its reports. End users are a partner's customers,
 * enrolled by the partner: they own their files and are charged to its
 * account, but are not listed or counted as members.
 */
export enum OrganizationRole {
  Admin = "admin",
  Member = "member",
  EndUser = "end_user",
}

/** The roles a member can be given. End users are only ever enrolled. */
export const MEMBER_ROLES = [
  OrganizationRole.Admin,
  OrganizationRole.Member,
] as const;

/**
 * The `oauthProvider` of a partner organisation's service user: a member that
 * owns the organisation's API keys, so they outlive any one person. No sign-in
 * returns this provider, so nobody can log in as it.
 */
export const SERVICE_USER_PROVIDER = "service";

export type OrganizationMember = {
  publicId: string;
  role: OrganizationRole;
};

export type OrganizationWithMembers = Organization & {
  archivedAt: string | null;
  members: string[];
  memberships: OrganizationMember[];
};

export type OrganizationSummary = Organization & {
  archivedAt: string | null;
  memberCount: number;
};

/** A partner organisation and the account its members share. */
export type PartnerOrganization = OrganizationSummary & {
  accountId: string;
};

/** An organisation's API keys, and what the caller may do with them. */
export type OrganizationApiKeys = {
  apiKeys: ApiKeyWithoutSecret[];
  canCreate: boolean;
  canRevoke: boolean;
};

/**
 * A partner's customer, identified by the address of their wallet key.
 * `customerReference` is the partner's own reference for them, and
 * `uploadQuotaBytes` their upload quota (null for the organisation's default).
 */
export type EndUser = {
  // EIP-55 checksummed.
  address: string;
  publicId: string;
  customerReference: string;
  uploadQuotaBytes: number | null;
  createdAt: string;
};

/**
 * One move into, out of or within an organisation. `fromOrganizationId` and
 * `toOrganizationId` are equal for a role change.
 */
export type OrganizationMembershipChange = {
  id: string;
  publicId: string;
  fromOrganizationId: string | null;
  toOrganizationId: string | null;
  role: OrganizationRole | null;
  // Public ID of who made the change: an Auto Drive admin, or for end users
  // an organisation admin or the organisation's API key (its service user).
  actor: string;
  createdAt: string;
};
