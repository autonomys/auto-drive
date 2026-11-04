import { PublicId } from "./user";

export type Organization = {
  id: string;
  name: string;
};

/**
 * Organisation admins manage the organisation (its API keys, #889); members
 * use its account. Both see its reports.
 */
export enum OrganizationRole {
  Admin = "admin",
  Member = "member",
}

export type OrganizationMember = {
  publicId: PublicId;
  role: OrganizationRole;
};

export type OrganizationWithMembers = Organization & {
  archivedAt: string | null;
  members: PublicId[];
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

/**
 * One move into, out of or within an organisation. `fromOrganizationId` and
 * `toOrganizationId` are equal for a role change.
 */
export type OrganizationMembershipChange = {
  id: string;
  publicId: PublicId;
  fromOrganizationId: string | null;
  toOrganizationId: string | null;
  role: OrganizationRole | null;
  // Public ID of the Auto Drive admin who made the change.
  actor: string;
  createdAt: string;
};
