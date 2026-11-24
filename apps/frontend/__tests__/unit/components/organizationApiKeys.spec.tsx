/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ButtonHTMLAttributes } from 'react';
import type { ApiKey, OrganizationApiKeys } from '@auto-drive/models';
import { OrganizationApiKeys as OrganizationApiKeysView } from '../../../src/components/organisms/OrganizationApiKeys';

const getOrganizationApiKeys =
  jest.fn<(organizationId: string) => Promise<OrganizationApiKeys>>();
const createOrganizationApiKey =
  jest.fn<(organizationId: string, input: unknown) => Promise<ApiKey>>();
const revokeOrganizationApiKey =
  jest.fn<(organizationId: string, apiKeyId: string) => Promise<void>>();
const api = {
  getOrganizationApiKeys,
  createOrganizationApiKey,
  revokeOrganizationApiKey,
};

jest.mock('next/navigation', () => ({
  usePathname: () => '/mainnet/drive/developers',
  useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock('../../../src/contexts/network', () => ({
  useNetwork: () => ({ api, network: { id: 'mainnet' } }),
}));
jest.mock('@auto-drive/ui', () => ({
  ...jest.requireActual<typeof import('@auto-drive/ui')>('@auto-drive/ui'),
  Button: ({
    children,
    onClick,
    disabled,
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const organizationId = 'partner-org';
const key = {
  id: 'org-key',
  name: 'Production',
  maskedSecret: 'abc••••xyz',
  oauthProvider: 'service',
  oauthUserId: organizationId,
  deletedAt: null,
  expiresAt: null,
  createdAt: new Date('2026-11-01'),
} as OrganizationApiKeys['apiKeys'][number];

const renderKeys = async (canCreate: boolean, canRevoke: boolean) => {
  getOrganizationApiKeys.mockResolvedValue({
    apiKeys: [key],
    canCreate,
    canRevoke,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <OrganizationApiKeysView organizationId={organizationId} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Production')).toBeTruthy();
};

describe('organization API keys', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('lets an organization admin create a key and see its secret once', async () => {
    createOrganizationApiKey.mockResolvedValue({
      ...key,
      id: 'new-key',
      name: null,
      secret: 'the-secret',
    });
    await renderKeys(true, true);

    fireEvent.click(screen.getByText('Create API Key'));
    fireEvent.click(await screen.findByText('Generate'));

    expect(await screen.findByText('the-secret')).toBeTruthy();
    expect(createOrganizationApiKey).toHaveBeenCalledWith(organizationId, {
      name: null,
      expiresAt: null,
    });
  });

  it('lets an organization admin delete a key', async () => {
    revokeOrganizationApiKey.mockResolvedValue(undefined);
    await renderKeys(true, true);

    fireEvent.click(screen.getByText('Delete'));
    const buttons = await screen.findAllByText('Delete');
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() =>
      expect(revokeOrganizationApiKey).toHaveBeenCalledWith(
        organizationId,
        'org-key',
      ),
    );
  });

  it('only lists the keys to a member who is not an organization admin', async () => {
    await renderKeys(false, false);

    expect(screen.queryByText('Create API Key')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
    expect(
      screen.getByText(/Only organization admins can create and revoke them/),
    ).toBeTruthy();
  });

  it('lets an Auto Drive admin delete a key but not create one', async () => {
    await renderKeys(false, true);

    expect(screen.queryByText('Create API Key')).toBeNull();
    expect(screen.getByText('Delete')).toBeTruthy();
  });
});
