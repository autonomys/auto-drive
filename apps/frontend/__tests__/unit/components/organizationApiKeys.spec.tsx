/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ButtonHTMLAttributes } from 'react';
import {
  ApiKeyScope,
  type ApiKey,
  type OrganizationApiKeys,
} from '@auto-drive/models';
import { OrganizationApiKeys as OrganizationApiKeysView } from '../../../src/components/organisms/OrganizationApiKeys';
import { ApiKeysTable } from '../../../src/components/organisms/ApiKeysTable';

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

const renderKeys = async (
  canCreate: boolean,
  canRevoke: boolean,
  apiKeys = [key],
) => {
  getOrganizationApiKeys.mockResolvedValue({
    apiKeys,
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

  it('lets an organization admin create a key limited to end-user enrollment and usage', async () => {
    createOrganizationApiKey.mockResolvedValue({
      ...key,
      id: 'new-key',
      secret: 'the-secret',
      scopes: [ApiKeyScope.EndUserEnrollment, ApiKeyScope.Usage],
    });
    await renderKeys(true, true);

    fireEvent.click(screen.getByText('Create API Key'));
    fireEvent.change(await screen.findByLabelText('Access'), {
      target: { value: 'scoped' },
    });
    const generate = screen.getByText('Generate') as HTMLButtonElement;
    expect(generate.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/End-user enrollment/));
    fireEvent.click(screen.getByLabelText(/^Usage/));
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);

    expect(await screen.findByText('the-secret')).toBeTruthy();
    expect(createOrganizationApiKey).toHaveBeenCalledWith(organizationId, {
      name: null,
      expiresAt: null,
      scopes: [ApiKeyScope.EndUserEnrollment, ApiKeyScope.Usage],
    });
  });

  it('shows the scopes of every key, and full access for keys without', async () => {
    await renderKeys(false, false, [
      { ...key, scopes: null },
      {
        ...key,
        id: 'backend-key',
        name: 'Backend',
        scopes: [ApiKeyScope.EndUserEnrollment, ApiKeyScope.Usage],
      },
    ]);

    expect(screen.getByText('Access')).toBeTruthy();
    expect(screen.getByText('Full access')).toBeTruthy();
    expect(screen.getByText('End-user enrollment, Usage')).toBeTruthy();
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

describe('personal API keys', () => {
  it('offers no scopes, which auth refuses on a personal key', async () => {
    const createKey = jest.fn<(input: unknown) => Promise<ApiKey>>();
    createKey.mockResolvedValue({ ...key, secret: 'the-secret' } as ApiKey);
    render(
      <ApiKeysTable
        apiKeys={[key]}
        createKey={createKey}
        onChanged={jest.fn()}
      />,
    );

    expect(screen.queryByText('Access')).toBeNull();
    fireEvent.click(screen.getByText('Create API Key'));
    expect(screen.queryByLabelText('Access')).toBeNull();
    fireEvent.click(await screen.findByText('Generate'));

    expect(await screen.findByText('the-secret')).toBeTruthy();
    expect(createKey).toHaveBeenCalledWith({ name: null, expiresAt: null });
  });
});
