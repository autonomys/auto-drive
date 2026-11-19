import {
  ApiKey,
  IntentStatus,
  OrganizationRole,
  SERVICE_USER_PROVIDER,
  User,
  UserRole,
  UserWithOrganization,
  deriveUserPublicId,
} from '@auto-drive/models'
import { jest } from '@jest/globals'
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
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { ownershipRepository } from '../../../src/infrastructure/repositories/objects/ownership.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../src/errors/index.js'

const admin = { role: UserRole.Admin, publicId: 'admin-pub' } as User

describe('Partner organizations', () => {
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

  it('creates a partner account that members resolve to', async () => {
    const organizationId = uuidv4()
    jest
      .spyOn(AuthManager, 'createOrganization')
      .mockResolvedValue(ok({ id: organizationId, name: 'Partner' }))

    const created = (
      await OrganizationsUseCases.createPartnerOrganization(admin, 'Partner')
    )._unsafeUnwrap()

    const member = { ...createMockUser(), organizationId }
    const account = await AccountsUseCases.getOrCreateAccount(member)
    expect(account).toMatchObject({ id: created.accountId, isPartner: true })
    expect(
      (await accountsRepository.getPartnerAccounts()).map((a) => a.id),
    ).toEqual([created.accountId])
    // A personal account is not a partner account.
    const personal = await AccountsUseCases.getOrCreateAccount(createMockUser())
    expect(personal.isPartner).toBe(false)
  })

  it('refuses to move a buyer with a confirmed payment', async () => {
    const organizationId = uuidv4()
    jest
      .spyOn(AuthManager, 'createOrganization')
      .mockResolvedValue(ok({ id: organizationId, name: 'Partner' }))
    await OrganizationsUseCases.createPartnerOrganization(admin, 'Partner')

    const buyer = createMockUser()
    await AccountsUseCases.getOrCreateAccount(buyer)
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(buyer)
    const addMember = jest.spyOn(AuthManager, 'addOrganizationMember')
    const db = await getDatabase()
    await db.query(
      `INSERT INTO intents (id, user_public_id, status, shannons_per_byte, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), buyer.publicId, IntentStatus.CONFIRMED, '1', new Date()],
    )

    const result = await OrganizationsUseCases.addMember(
      admin,
      organizationId,
      buyer.publicId,
      OrganizationRole.Member,
    )

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(addMember).not.toHaveBeenCalled()
  })

  describe('API keys', () => {
    const organizationId = uuidv4()
    const organizationAdmin = { ...createMockUser(), organizationId }
    const member = { ...createMockUser(), organizationId }

    beforeEach(async () => {
      jest
        .spyOn(AuthManager, 'createOrganization')
        .mockResolvedValue(ok({ id: organizationId, name: 'Partner' }))
      await OrganizationsUseCases.createPartnerOrganization(admin, 'Partner')
      jest.spyOn(AuthManager, 'getOrganization').mockResolvedValue(
        ok({
          id: organizationId,
          name: 'Partner',
          archivedAt: null,
          members: [],
          memberships: [
            {
              publicId: organizationAdmin.publicId,
              role: OrganizationRole.Admin,
            },
            { publicId: member.publicId, role: OrganizationRole.Member },
          ],
        }),
      )
    })

    // Whether each caller may list, create and revoke the keys.
    it.each([
      ['an organization admin', organizationAdmin, [true, true, true]],
      ['a member', member, [true, false, false]],
      [
        'an Auto Drive admin',
        { ...createMockUser(), role: UserRole.Admin },
        [true, false, true],
      ],
      ['a non-member', createMockUser(), [false, false, false]],
      [
        'an organization admin using an API key',
        { ...organizationAdmin, apiKeyId: 'personal-key' },
        [false, false, false],
      ],
    ] as const)('lets %s do only what they may', async (_, caller, allowed) => {
      const auth = [
        jest
          .spyOn(AuthManager, 'getOrganizationApiKeys')
          .mockResolvedValue(ok([])),
        jest
          .spyOn(AuthManager, 'createOrganizationApiKey')
          .mockResolvedValue(ok({ id: 'org-key' } as ApiKey)),
        jest
          .spyOn(AuthManager, 'revokeOrganizationApiKey')
          .mockResolvedValue(ok(undefined)),
      ]

      const results = [
        await OrganizationsUseCases.listApiKeys(caller, organizationId),
        await OrganizationsUseCases.createApiKey(caller, organizationId, {
          name: 'Production',
        }),
        await OrganizationsUseCases.revokeApiKey(
          caller,
          organizationId,
          'org-key',
        ),
      ]

      expect(results.map((r) => r.isOk())).toEqual(allowed)
      expect(auth.map((call) => call.mock.calls.length > 0)).toEqual(allowed)
      for (const result of results) {
        if (result.isErr()) expect(result.error).toBeInstanceOf(ForbiddenError)
      }
    })

    it('has none for an organization that is not a partner', async () => {
      const user = createMockUser()
      const result = await OrganizationsUseCases.listApiKeys(
        user,
        user.organizationId!,
      )
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    })

    it('charges uploads made with a key to the partner account', async () => {
      const account =
        await accountsRepository.getByOrganizationId(organizationId)
      const db = await getDatabase()
      const intentId = uuidv4()
      await db.query(
        `INSERT INTO intents (id, user_public_id, status, shannons_per_byte, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [intentId, member.publicId, IntentStatus.COMPLETED, '1', new Date()],
      )
      await purchasedCreditsRepository.createPurchasedCredit({
        accountId: account!.id,
        intentId,
        uploadBytesOriginal: 1_000_000n,
        downloadBytesOriginal: 0n,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      // What auth resolves an organization key to.
      const serviceUser: UserWithOrganization = {
        oauthProvider: SERVICE_USER_PROVIDER,
        oauthUserId: organizationId,
        publicId: deriveUserPublicId(SERVICE_USER_PROVIDER, organizationId),
        role: UserRole.User,
        onboarded: true,
        organizationId,
        apiKeyId: 'org-key',
      }

      const upload = await UploadsUseCases.createFileUpload(
        serviceUser,
        'report.txt',
        null,
        null,
        null,
        null,
      )
      await UploadsUseCases.uploadChunk(
        serviceUser,
        upload.id,
        0,
        Buffer.from('partner data'),
      )
      const cid = await UploadsUseCases.completeUpload(serviceUser, upload.id)

      expect(await ownershipRepository.getOwnerships(cid)).toEqual([
        expect.objectContaining({
          oauth_provider: SERVICE_USER_PROVIDER,
          oauth_user_id: organizationId,
          is_admin: true,
        }),
      ])
      const interactions = await db.query(
        'SELECT account_id, api_key_id, source FROM interactions WHERE cid = $1',
        [cid],
      )
      expect(interactions.rows).toEqual([
        { account_id: account!.id, api_key_id: 'org-key', source: 'purchased' },
      ])
    })
  })
})
