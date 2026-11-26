import {
  OrganizationMembershipChange,
  OrganizationRole,
} from '@auto-drive/models';

export const ROLE_LABEL: Record<OrganizationRole, string> = {
  [OrganizationRole.Admin]: 'Admin',
  [OrganizationRole.Member]: 'Member',
  [OrganizationRole.PartnerEndUser]: 'Partner end user',
};

export const describeMembershipChange = (
  change: OrganizationMembershipChange,
  organizationId: string,
): string => {
  const role = change.role ? ROLE_LABEL[change.role] : '—';
  if (change.fromOrganizationId === change.toOrganizationId) {
    return `Role changed to ${role}`;
  }
  if (change.toOrganizationId === organizationId) {
    return `Joined as ${role}`;
  }
  return 'Removed, returned to their personal organization';
};
