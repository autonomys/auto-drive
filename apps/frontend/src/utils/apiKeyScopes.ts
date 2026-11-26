import { ApiKeyScope } from '@auto-drive/models';

/** The scopes an organization key can be limited to, in the picker's order. */
export const API_KEY_SCOPES: {
  scope: ApiKeyScope;
  label: string;
  description: string;
}[] = [
  {
    scope: ApiKeyScope.Files,
    label: 'Files',
    description: 'Upload, download and manage files, also through S3.',
  },
  {
    scope: ApiKeyScope.EndUserEnrollment,
    label: 'End-user enrollment',
    description: 'Enroll end users and list them.',
  },
  {
    scope: ApiKeyScope.EndUserRemoval,
    label: 'End-user removal',
    description:
      'Remove end users and list them. Keep it off the key your backend uses day to day.',
  },
  {
    scope: ApiKeyScope.Usage,
    label: 'Usage',
    description: 'Read the account and its usage report.',
  },
];

/** A key's access as the key list shows it. No scopes means full access. */
export const describeScopes = (
  scopes: ApiKeyScope[] | null | undefined,
): string =>
  scopes
    ? scopes
        .map(
          (scope) =>
            API_KEY_SCOPES.find((entry) => entry.scope === scope)?.label ??
            scope,
        )
        .join(', ')
    : 'Full access';
