jest.mock('@auto-drive/models', () => ({
  isInsecure: (tags: string[]) => tags.includes('insecure'),
  isBanned: (tags: string[]) => tags.includes('banned'),
}));

import {
  BulkDownloadItem,
  EncryptionContext,
  hasEncryption,
  itemIsRunnable,
  resolveEncryptionOptions,
  shouldSkipEncrypted,
  shouldSkipInsecure,
} from '../../../src/services/bulkObjectDownload';

const baseInformation = {
  tags: [] as string[],
  metadata: {
    dataCid: 'bafkr6itestcid',
    name: 'test.txt',
    type: 'file',
    totalSize: 12,
    uploadOptions: {},
  },
} as unknown as BulkDownloadItem['information'];

interface InformationOverrides {
  tags?: string[];
  metadata?: Record<string, unknown>;
}

const makeItem = (
  overrides: Partial<BulkDownloadItem> = {},
  informationOverrides: InformationOverrides = {},
): BulkDownloadItem => ({
  cid: 'bafkr6itestcid',
  status: 'pending',
  ...overrides,
  information: {
    ...baseInformation,
    ...informationOverrides,
    metadata: {
      ...baseInformation!.metadata,
      ...(informationOverrides.metadata ?? {}),
    },
  } as BulkDownloadItem['information'],
});

const encryptionMetadata = {
  uploadOptions: {
    encryption: { algorithm: 'aes-256-gcm' },
  },
};

describe('hasEncryption', () => {
  it('returns true when the upload options declare an encryption algorithm', () => {
    expect(hasEncryption(makeItem({}, { metadata: encryptionMetadata }))).toBe(
      true,
    );
  });

  it('returns false when no encryption algorithm is declared', () => {
    expect(hasEncryption(makeItem())).toBe(false);
  });

  it('returns false for items without metadata', () => {
    expect(
      hasEncryption({ cid: 'x', status: 'failed' } as BulkDownloadItem),
    ).toBe(false);
  });
});

describe('itemIsRunnable', () => {
  it('is true for pending items with information', () => {
    expect(itemIsRunnable(makeItem({ status: 'pending' }))).toBe(true);
  });

  it('is false for non-pending items', () => {
    for (const status of [
      'skipped',
      'checking',
      'preparing',
      'downloading',
      'completed',
      'failed',
    ] as const) {
      expect(itemIsRunnable(makeItem({ status }))).toBe(false);
    }
  });

  it('is false when information is missing (metadata load failed)', () => {
    expect(
      itemIsRunnable({
        cid: 'x',
        status: 'pending',
      } as BulkDownloadItem),
    ).toBe(false);
  });
});

describe('shouldSkipInsecure', () => {
  it('skips insecure items when the user has not confirmed', () => {
    const item = makeItem({}, { tags: ['insecure'] });
    expect(shouldSkipInsecure(item, false)).toBe(true);
  });

  it('does not skip insecure items once confirmed', () => {
    const item = makeItem({}, { tags: ['insecure'] });
    expect(shouldSkipInsecure(item, true)).toBe(false);
  });

  it('does not skip non-insecure items', () => {
    expect(shouldSkipInsecure(makeItem(), false)).toBe(false);
  });

  it('does not skip when information is missing', () => {
    expect(
      shouldSkipInsecure(
        { cid: 'x', status: 'pending' } as BulkDownloadItem,
        false,
      ),
    ).toBe(false);
  });
});

describe('shouldSkipEncrypted', () => {
  const encryptedItem = makeItem({}, { metadata: encryptionMetadata });

  it('skips encrypted items when the user chose skip and has no default password', () => {
    const ctx: EncryptionContext = {
      defaultPassword: undefined,
      encryptionChoice: 'skip',
      sharedPassword: '',
    };
    expect(shouldSkipEncrypted(encryptedItem, ctx)).toBe(true);
  });

  it('does not skip encrypted items when a default password is set', () => {
    const ctx: EncryptionContext = {
      defaultPassword: 'pw',
      encryptionChoice: 'skip',
      sharedPassword: '',
    };
    expect(shouldSkipEncrypted(encryptedItem, ctx)).toBe(false);
  });

  it('does not skip when user chose download-encrypted', () => {
    const ctx: EncryptionContext = {
      defaultPassword: undefined,
      encryptionChoice: 'download-encrypted',
      sharedPassword: '',
    };
    expect(shouldSkipEncrypted(encryptedItem, ctx)).toBe(false);
  });

  it('does not skip non-encrypted items even with skip choice', () => {
    const ctx: EncryptionContext = {
      defaultPassword: undefined,
      encryptionChoice: 'skip',
      sharedPassword: '',
    };
    expect(shouldSkipEncrypted(makeItem(), ctx)).toBe(false);
  });
});

describe('resolveEncryptionOptions', () => {
  const encryptedItem = makeItem({}, { metadata: encryptionMetadata });

  it('returns no password and no skip for non-encrypted items', () => {
    expect(
      resolveEncryptionOptions(makeItem(), {
        defaultPassword: 'pw',
        encryptionChoice: 'shared-password',
        sharedPassword: 'shared',
      }),
    ).toEqual({ password: undefined, skipDecryption: false });
  });

  it('uses the default password when one is set', () => {
    expect(
      resolveEncryptionOptions(encryptedItem, {
        defaultPassword: 'defaultpw',
        encryptionChoice: null,
        sharedPassword: '',
      }),
    ).toEqual({ password: 'defaultpw', skipDecryption: false });
  });

  it('returns skipDecryption=true when user chose download-encrypted', () => {
    expect(
      resolveEncryptionOptions(encryptedItem, {
        defaultPassword: undefined,
        encryptionChoice: 'download-encrypted',
        sharedPassword: 'ignored',
      }),
    ).toEqual({ password: undefined, skipDecryption: true });
  });

  it('uses the shared password when user chose shared-password', () => {
    expect(
      resolveEncryptionOptions(encryptedItem, {
        defaultPassword: undefined,
        encryptionChoice: 'shared-password',
        sharedPassword: 'sharedpw',
      }),
    ).toEqual({ password: 'sharedpw', skipDecryption: false });
  });

  it('falls back to no-password/no-skip when user chose skip', () => {
    expect(
      resolveEncryptionOptions(encryptedItem, {
        defaultPassword: undefined,
        encryptionChoice: 'skip',
        sharedPassword: '',
      }),
    ).toEqual({ password: undefined, skipDecryption: false });
  });

  it('prefers default password over an explicit shared-password choice', () => {
    expect(
      resolveEncryptionOptions(encryptedItem, {
        defaultPassword: 'defaultpw',
        encryptionChoice: 'shared-password',
        sharedPassword: 'sharedpw',
      }),
    ).toEqual({ password: 'defaultpw', skipDecryption: false });
  });
});
