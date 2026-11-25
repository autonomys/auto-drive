import { ApiKeyWithoutSecret } from "./apiKey";

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
 * One move into, out of or within an organisation. `fromOrganizationId` and
 * `toOrganizationId` are equal for a role change.
 */
export type OrganizationMembershipChange = {
  id: string;
  publicId: string;
  fromOrganizationId: string | null;
  toOrganizationId: string | null;
  role: OrganizationRole | null;
  // Public ID of the Auto Drive admin who made the change.
  actor: string;
  createdAt: string;
};

/**
 * An offer to join a partner organisation. Organisation admins invite by
 * public ID; the user joins only by accepting it.
 */
export type OrganizationInvitation = {
  id: string;
  organizationId: string;
  publicId: string;
  role: OrganizationRole;
  // Public ID of who sent it.
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
};

/** An invitation as the invited user sees it. */
export type ReceivedOrganizationInvitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  createdAt: string;
  expiresAt: string;
};

/**
 * A partner organisation as its members see it. Byte amounts are decimal
 * strings.
 */
export type OrganizationOverview = {
  id: string;
  name: string;
  accountId: string;
  // The caller's role, null for an Auto Drive admin who is not a member.
  viewerRole: OrganizationRole | null;
  // Whether the caller may invite, remove members and change roles.
  canManageMembers: boolean;
  // By public ID only: members don't see each other's sign-in names.
  members: OrganizationMember[];
  credits: {
    purchasedBytesRemaining: string;
    // Soonest expiry of the purchased credits left, or null when none.
    purchasedNextExpiry: string | null;
    // Monthly and one-time free credits left.
    freeCreditBytesRemaining: string;
    // Issued at the start of each UTC month; 0 = none.
    monthlyFreeUploadBytes: string;
    // What is left of this month's free credits.
    monthlyFreeBytesRemaining: string;
    // One-time free credits: what is left, what was granted in all and in how
    // many grants, and the soonest expiry of those left (null when none).
    oneTimeFreeBytesRemaining: string;
    oneTimeFreeBytesGranted: string;
    oneTimeFreeGrantCount: number;
    oneTimeFreeNextExpiry: string | null;
    // Most purchased credits the account may hold at once.
    maxPurchasedBytes: string;
    // Days purchased credits last.
    creditExpiryDays: number;
  };
};
