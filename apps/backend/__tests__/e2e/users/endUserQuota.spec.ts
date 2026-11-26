import {
  InteractionType,
  OrganizationRole,
  User,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { jest } from '@jest/globals'
import { randomBytes } from 'crypto'
import { ok } from 'neverthrow'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { OrganizationsUseCases } from '../../../src/core/users/organizations.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { OwnershipUseCases } from '../../../src/core/objects/ownership.js'
import { UsageReportsUseCases } from '../../../src/core/users/usageReports.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { PaymentRequiredError } from '../../../src/errors/index.js'

const admin = { role: UserRole.Admin, publicId: 'admin-pub' } as User

describe('Partner end user quotas', () => {
  beforeEach(async () => {
    mockRabbitPublish()
    await getDatabase()
    await dbMigration.up()
  })

  afterEach(async () => {
    unmockMethods()
    jest.restoreAllMocks()
    await dbMigration.down()
  })

  // A partner organization with plenty of credits, its per-person maximum
  // and daily upload limit set (the limit left unset if null), and a member.
  const createPartner = async (
    maxEndUserQuotaBytes: number,
    dailyUploadLimitBytes: number | null = 1_000_000,
  ) => {
    const organizationId = uuidv4()
    jest
      .spyOn(AuthManager, 'createOrganization')
      .mockResolvedValue(ok({ id: organizationId, name: 'Partner' }))
    await OrganizationsUseCases.createPartnerOrganization(admin, 'Partner')
    const member = { ...createMockUser(), organizationId }
    const account = await AccountsUseCases.getOrCreateAccount(member)
    expect(
      (
        await AccountsUseCases.grantFreeCredits(admin, account.id, {
          uploadBytes: 1_000_000,
          reason: 'Pilot',
        })
      ).isOk(),
    ).toBe(true)
    await accountsRepository.setMaxEndUserQuota(
      account.id,
      maxEndUserQuotaBytes,
      'org-admin',
    )
    if (dailyUploadLimitBytes !== null) {
      await accountsRepository.setDailyUploadLimit(
        account.id,
        dailyUploadLimitBytes,
        'org-admin',
      )
    }
    return { member, account }
  }

  const endUserOf = (
    member: UserWithOrganization,
    customerReference: string,
    uploadQuotaBytes: number | null = null,
  ): UserWithOrganization => ({
    ...createMockUser(),
    oauthProvider: 'web3-wallet',
    organizationId: member.organizationId,
    organizationRole: OrganizationRole.PartnerEndUser,
    customerReference,
    uploadQuotaBytes,
    endUserRemovedAt: null,
  })

  const upload = (
    user: UserWithOrganization,
    bytes: number,
    customerReference: string | null = null,
  ) =>
    AccountsUseCases.registerInteraction(
      user,
      InteractionType.Upload,
      BigInt(bytes),
      undefined,
      customerReference,
    )

  // Bytes recorded per customer reference.
  const uploaded = async (accountId: string) => {
    const db = await getDatabase()
    const { rows } = await db.query<{ ref: string | null; bytes: string }>(
      `SELECT customer_reference AS ref, SUM(size)::text AS bytes
       FROM interactions WHERE account_id = $1 AND type = 'upload'
       GROUP BY customer_reference ORDER BY customer_reference`,
      [accountId],
    )
    return Object.fromEntries(rows.map((r) => [r.ref, Number(r.bytes)]))
  }

  it('records end users under their enrollment reference, whatever the request sends', async () => {
    const { member, account } = await createPartner(1000)
    const endUser = endUserOf(member, 'person-1')

    await upload(endUser, 10, 'someone-else')
    await upload(endUser, 20)
    await upload(member, 30, 'sent-by-member')

    expect(await uploaded(account.id)).toEqual({
      'person-1': 30,
      'sent-by-member': 30,
    })

    const file = await UploadsUseCases.createFileUpload(
      endUser,
      'a.txt',
      null,
      null,
      null,
      null,
      'someone-else',
    )
    const folder = await UploadsUseCases.createFolderUpload(
      endUser,
      'f',
      { type: 'folder', name: 'f', id: 'root', children: [] },
      null,
      'someone-else',
    )
    const inFolder = await UploadsUseCases.createFileInFolder(
      endUser,
      folder.id,
      'a',
      'a.txt',
      null,
      null,
      'someone-else',
    )
    for (const { id } of [file, folder, inFolder]) {
      expect(
        (await uploadsRepository.getUploadEntryById(id))?.customer_reference,
      ).toBe('person-1')
    }
  })

  it('refuses an upload past the quota without charging it', async () => {
    const { member, account } = await createPartner(1000)
    const endUser = endUserOf(member, 'person-1')
    await upload(endUser, 600)
    const before = await AccountsUseCases.getPendingCreditsByUserAndType(
      endUser,
      InteractionType.Upload,
    )

    const refused = upload(endUser, 401)
    await expect(refused).rejects.toThrow(PaymentRequiredError)
    await expect(refused).rejects.toThrow(
      'upload quota of 1000 bytes (600 bytes used)',
    )
    expect(await uploaded(account.id)).toEqual({ 'person-1': 600 })
    expect(
      await AccountsUseCases.getPendingCreditsByUserAndType(
        endUser,
        InteractionType.Upload,
      ),
    ).toBe(before)

    // Exactly up to the quota, and the person's quota is theirs alone.
    await upload(endUser, 400)
    await upload(endUserOf(member, 'person-2'), 1000)
    expect(await uploaded(account.id)).toEqual({
      'person-1': 1000,
      'person-2': 1000,
    })
  })

  it('applies the lower of their own quota and the current maximum', async () => {
    const { member, account } = await createPartner(1000)

    const lower = endUserOf(member, 'lower', 300)
    await expect(upload(lower, 301)).rejects.toThrow('quota of 300 bytes')
    await upload(lower, 300)

    // A quota above the maximum, set before the maximum was lowered.
    const higher = endUserOf(member, 'higher', 5000)
    await expect(upload(higher, 1001)).rejects.toThrow('quota of 1000 bytes')
    await upload(higher, 600)

    await accountsRepository.setMaxEndUserQuota(account.id, 500, 'org-admin')
    await expect(upload(higher, 1)).rejects.toThrow(
      'quota of 500 bytes (600 bytes used)',
    )
    await expect(upload(endUserOf(member, 'new'), 501)).rejects.toThrow(
      'quota of 500 bytes',
    )
  })

  it('gives no quota back when a file is removed, and removes nothing past it', async () => {
    const { member, account } = await createPartner(1000)
    const endUser = endUserOf(member, 'person-1')
    const cid = `cid-${uuidv4()}`
    await ObjectUseCases.saveMetadata(cid, cid, {
      type: 'file',
      dataCid: cid,
      name: 'a.txt',
      totalSize: 600n,
      totalChunks: 1,
      chunks: [],
    })
    await OwnershipUseCases.setUserAsAdmin(endUser, cid)
    await upload(endUser, 600)

    expect((await ObjectUseCases.markAsDeleted(endUser, cid)).isOk()).toBe(true)
    await expect(upload(endUser, 401)).rejects.toThrow(
      'quota of 1000 bytes (600 bytes used)',
    )

    // Lowering their quota below what they used refuses their next upload
    // and leaves their files alone.
    expect((await ObjectUseCases.restoreObject(endUser, cid)).isOk()).toBe(true)
    await expect(
      upload({ ...endUser, uploadQuotaBytes: 500 }, 1),
    ).rejects.toThrow('quota of 500 bytes (600 bytes used)')
    expect(await uploaded(account.id)).toEqual({ 'person-1': 600 })
    expect(await OwnershipUseCases.getOwners(cid)).toHaveLength(1)
  })

  it('lets no end user upload before the maximum is set', async () => {
    const { member } = await createPartner(0)
    const endUser = endUserOf(member, 'person-1', 100)

    await expect(upload(endUser, 1)).rejects.toThrow('quota of 0 bytes')
    await expect(
      UploadsUseCases.createFileUpload(endUser, 'a.txt', null, null),
    ).rejects.toThrow(PaymentRequiredError)
  })

  it('refuses a new upload once nothing is left of the quota', async () => {
    const { member } = await createPartner(100)
    const endUser = endUserOf(member, 'person-1')
    const tree = { type: 'folder' as const, name: 'f', id: 'r', children: [] }

    await upload(endUser, 99)
    await UploadsUseCases.createFileUpload(endUser, 'a.txt', null, null)
    await upload(endUser, 1)

    await expect(
      UploadsUseCases.createFileUpload(endUser, 'b.txt', null, null),
    ).rejects.toThrow(PaymentRequiredError)
    await expect(
      UploadsUseCases.createFolderUpload(endUser, 'f', tree, null),
    ).rejects.toThrow(PaymentRequiredError)
    // Members have no quota.
    await UploadsUseCases.createFileUpload(member, 'c.txt', null, null)
  })

  it('lets only one of two concurrent uploads past the quota through', async () => {
    const { member, account } = await createPartner(1000)
    const endUser = endUserOf(member, 'person-1')

    const results = await Promise.allSettled([
      upload(endUser, 600),
      upload(endUser, 600),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ])
    expect(await uploaded(account.id)).toEqual({ 'person-1': 600 })
  })

  it('gives a file only to the one of two concurrent completions it charged', async () => {
    const { member } = await createPartner(1000)
    const endUser = endUserOf(member, 'person-1')
    const files = await Promise.all(
      [0, 1].map(async () => {
        const file = await UploadsUseCases.createFileUpload(
          endUser,
          `${uuidv4()}.bin`,
          'application/octet-stream',
          null,
        )
        await UploadsUseCases.uploadChunk(endUser, file.id, 0, randomBytes(600))
        return file
      }),
    )

    const results = await Promise.allSettled(
      files.map(({ id }) => UploadsUseCases.completeUpload(endUser, id)),
    )

    const charged = results.flatMap((r) =>
      r.status === 'fulfilled' ? [r.value] : [],
    )
    expect(charged).toHaveLength(1)
    const db = await getDatabase()
    const owned = await db.query<{ cid: string }>(
      'SELECT cid FROM object_ownership WHERE oauth_provider = $1 AND oauth_user_id = $2',
      [endUser.oauthProvider, endUser.oauthUserId],
    )
    expect(owned.rows.map((r) => r.cid)).toEqual(charged)
    const saved = await db.query<{ root_cid: string }>(
      'SELECT root_cid FROM metadata',
    )
    expect(saved.rows.map((r) => r.root_cid)).toEqual(charged)
  })

  describe('daily upload limit', () => {
    const setDaily = (accountId: string, bytes: number | null) =>
      accountsRepository.setDailyUploadLimit(accountId, bytes, 'org-admin')

    it('refuses end users until it is set or switched off, and nobody else', async () => {
      const { member, account } = await createPartner(1000, null)
      const endUser = endUserOf(member, 'person-1')

      await expect(upload(endUser, 1)).rejects.toThrow(
        'haven\'t set its daily upload limit',
      )
      await expect(
        UploadsUseCases.createFileUpload(endUser, 'a.txt', null, null),
      ).rejects.toThrow(PaymentRequiredError)
      await upload(member, 1, 'staff')

      await setDaily(account.id, null)
      await upload(endUser, 1)
      expect(await uploaded(account.id)).toEqual({ 'person-1': 1, staff: 1 })
    })

    it('refuses any upload past it, counting the account\'s last 24 hours', async () => {
      const { member, account } = await createPartner(1000, 1000)
      const [first, second] = [
        endUserOf(member, 'person-1'),
        endUserOf(member, 'person-2'),
      ]
      await upload(first, 600)
      await upload(member, 300, 'staff')

      await expect(upload(second, 101)).rejects.toThrow(
        'daily upload limit of 1000 bytes (900 bytes uploaded in the last 24 hours)',
      )
      await expect(upload(member, 101, 'staff')).rejects.toThrow(
        PaymentRequiredError,
      )
      await upload(second, 100)
      await expect(
        UploadsUseCases.createFileUpload(second, 'a.txt', null, null),
      ).rejects.toThrow(PaymentRequiredError)

      // A day later, those uploads no longer count.
      const db = await getDatabase()
      await db.query(
        `UPDATE interactions SET created_at = LOCALTIMESTAMP - interval '25 hours'
         WHERE account_id = $1`,
        [account.id],
      )
      await upload(second, 900)
      expect(await uploaded(account.id)).toEqual({
        'person-1': 600,
        'person-2': 1000,
        staff: 300,
      })
    })

    it('lets only one of two concurrent uploads by different people past it', async () => {
      const { member, account } = await createPartner(1000, 1000)

      const results = await Promise.allSettled([
        upload(endUserOf(member, 'person-1'), 600),
        upload(endUserOf(member, 'person-2'), 600),
      ])

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ])
      expect(Object.values(await uploaded(account.id))).toEqual([600])
    })

    it('records each change in the terms history, switching off with its acknowledgement', async () => {
      const { account } = await createPartner(1000, null)

      await setDaily(account.id, 5000)
      await setDaily(account.id, 5000)
      const off = await setDaily(account.id, null)

      expect(off).toMatchObject({
        dailyUploadLimitBytes: null,
        dailyUploadLimitOff: true,
      })
      const changes = (await accountsRepository.getTermsChanges(account.id))
        .filter(({ field }) => field.startsWith('daily_upload_limit'))
        .map(({ field, oldValue, newValue, changedBy, reason }) => ({
          field,
          oldValue,
          newValue,
          changedBy,
          reason,
        }))
      const acknowledged = 'Switched off, acknowledged by the organization admin'
      expect(changes).toHaveLength(3)
      expect(changes).toEqual(
        expect.arrayContaining([
          {
            field: 'daily_upload_limit_bytes',
            oldValue: null,
            newValue: '5000',
            changedBy: 'org-admin',
            reason: null,
          },
          {
            field: 'daily_upload_limit_bytes',
            oldValue: '5000',
            newValue: null,
            changedBy: 'org-admin',
            reason: acknowledged,
          },
          {
            field: 'daily_upload_limit_off',
            oldValue: 'false',
            newValue: 'true',
            changedBy: 'org-admin',
            reason: acknowledged,
          },
        ]),
      )
    })
  })

  it('reports usage one row per person', async () => {
    const { member, account } = await createPartner(1000)
    await upload(endUserOf(member, 'person-1'), 100)
    await upload(endUserOf(member, 'person-2'), 200)
    await upload(endUserOf(member, 'person-2'), 300, 'ignored')

    const report = (
      await UsageReportsUseCases.getUsageReport(member, account.id, {
        from: new Date(Date.now() - 60_000),
        to: new Date(Date.now() + 60_000),
      })
    )._unsafeUnwrap()

    expect(
      report.customerReferences.map((r) => [
        r.customerReference,
        r.uploadCount,
        r.uploadBytes,
      ]),
    ).toEqual([
      ['person-2', 2, '500'],
      ['person-1', 1, '100'],
    ])
  })
})
