import { ApiKeyWithoutSecret } from "./apiKey.js";

export type Organization = {
  id: string;
  name: string;
};

/**
 * Organisation admins manage the organisation (its API keys, #889); members
 * use its account. Both see its reports. Partner end users are a partner's
 * customers, enrolled by the partner: they own their files and are charged to
 * its account, but are not listed or counted as members.
 */
export enum OrganizationRole {
  Admin = "admin",
  Member = "member",
  PartnerEndUser = "partner_end_user",
}

/**
 * The roles a member can be given. Partner end users are only ever enrolled.
 */
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
 * `uploadQuotaBytes` their upload quota (null to follow the account's
 * per-person maximum). `removedAt` is set while the partner has removed them:
 * they stay in the organisation, read-only, until it enrols them again.
 * `closedAt` is set too once they have closed their account.
 */
export type PartnerEndUser = {
  // EIP-55 checksummed.
  address: string;
  publicId: string;
  customerReference: string;
  uploadQuotaBytes: number | null;
  // When they were first enrolled.
  createdAt: string;
  removedAt: string | null;
  closedAt: string | null;
};

/**
 * What a membership change did to a partner end user, besides moving them:
 * their quota changed, or they closed their account. Null for every other
 * change.
 */
export enum EndUserChange {
  QuotaChanged = "quota_changed",
  AccountClosed = "account_closed",
}

/**
 * One move into, out of or within an organisation. `fromOrganizationId` and
 * `toOrganizationId` are equal for a role change. For a partner end user,
 * who never leaves the organisation, a change with no `toOrganizationId` is
 * a removal and one with no `fromOrganizationId` an enrolment.
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
  // The organisation API key that made an end user's change, which `actor`
  // can't tell apart from the organisation's other keys. Null otherwise.
  actorApiKeyId: string | null;
  // For a partner end user: a quota change or closing their account. A quota
  // change has the organisation as both its source and destination; a
  // closure, like a removal, has no destination.
  endUserChange: EndUserChange | null;
  // An end user's quota after their enrolment or quota change, null to follow
  // the per-person maximum. Null for every other change.
  uploadQuotaBytes: number | null;
  createdAt: string;
};

/**
 * An https origin of a partner's app. Wallet sign-ins for it are accepted only
 * from the partner organisation's end users, who may sign in for nothing else.
 */
export type PartnerOrigin = {
  origin: string;
  organizationId: string;
  // Public ID of the Auto Drive admin who registered it.
  createdBy: string;
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
  // The most any one of the organisation's end users may upload in total.
  maxEndUserQuotaBytes: string;
};
