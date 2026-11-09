import { IntentStatus, OrganizationRole, User, UserRole } from '@auto-drive/models'
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
import { ConflictError } from '../../../src/errors/index.js'

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
})
