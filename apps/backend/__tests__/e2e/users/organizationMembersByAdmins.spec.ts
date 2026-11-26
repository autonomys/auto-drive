import {
  IntentStatus,
  OrganizationRole,
  OrganizationWithMembers,
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
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnusedCreditsError,
} from '../../../src/errors/index.js'

const autoDriveAdmin = {
  ...createMockUser(),
  role: UserRole.Admin,
} as UserWithOrganization

describe('Partner organization members, managed by its admins', () => {
  const organizationId = uuidv4()
  const organizationAdmin = { ...createMockUser(), organizationId }
  const member = { ...createMockUser(), organizationId }
  // Someone outside the organization, in their personal one.
  const outsider = createMockUser()

  // Auth's view of the organization; tests change the members.
  let organization: OrganizationWithMembers

  const memberships = (
    ...members: [UserWithOrganization, OrganizationRole][]
  ) => members.map(([user, role]) => ({ publicId: user.publicId, role }))

  beforeEach(async () => {
    mockRabbitPublish()
    await getDatabase()
    await dbMigration.up()

    jest
      .spyOn(AuthManager, 'createOrganization')
      .mockResolvedValue(ok({ id: organizationId, name: 'Partner' }))
    await OrganizationsUseCases.createPartnerOrganization(
      autoDriveAdmin,
      'Partner',
    )

    organization = {
      id: organizationId,
      name: 'Partner',
      archivedAt: null,
      members: [],
      memberships: memberships(
        [organizationAdmin, OrganizationRole.Admin],
        [member, OrganizationRole.Member],
      ),
    }
    jest
      .spyOn(AuthManager, 'getOrganization')
      .mockImplementation(async () => ok(organization))
    jest
      .spyOn(AuthManager, 'getUserFromPublicId')
      .mockImplementation(async (publicId) =>
        [organizationAdmin, member, outsider, autoDriveAdmin].find(
          (u) => u.publicId === publicId,
        )!,
      )
    jest.spyOn(AuthManager, 'getOrganizationSummaries').mockResolvedValue(
      ok([
        { id: organizationId, name: 'Partner', archivedAt: null, memberCount: 2 },
      ]),
    )
  })

  afterEach(async () => {
    unmockMethods()
    jest.restoreAllMocks()
    await dbMigration.down()
  })

  const invite = (caller: UserWithOrganization, invitee = outsider) =>
    OrganizationsUseCases.inviteMember(
      caller,
      organizationId,
      invitee.publicId,
      OrganizationRole.Member,
    )

  describe('invitations', () => {
    it('lets the invitee join, recorded as made by the inviter', async () => {
      const addMember = jest
        .spyOn(AuthManager, 'addOrganizationMember')
        .mockResolvedValue(ok(undefined))
      const invitation = (await invite(organizationAdmin))._unsafeUnwrap()

      const received = (
        await OrganizationsUseCases.getReceivedInvitations(outsider)
      )._unsafeUnwrap()
      // Nothing about the inviter: the invitee is not a member yet.
      expect(received).toEqual([
        {
          id: invitation.id,
          organizationId,
          organizationName: 'Partner',
          role: OrganizationRole.Member,
          createdAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
        },
      ])
      // Nobody is moved by being invited.
      expect(addMember).not.toHaveBeenCalled()

      const accepted = await OrganizationsUseCases.acceptInvitation(
        outsider,
        invitation.id,
      )

      expect(accepted._unsafeUnwrap()).toEqual({ organizationId })
      expect(addMember).toHaveBeenCalledWith(
        organizationId,
        { publicId: outsider.publicId, role: OrganizationRole.Member },
        organizationAdmin.publicId,
      )
      // It is used up.
      expect(
        (
          await OrganizationsUseCases.getReceivedInvitations(outsider)
        )._unsafeUnwrap(),
      ).toEqual([])
      expect(
        (
          await OrganizationsUseCases.acceptInvitation(outsider, invitation.id)
        )._unsafeUnwrapErr(),
      ).toBeInstanceOf(NotFoundError)
    })

    it.each([
      ['a member', member],
      ['a non-member', createMockUser()],
      [
        'an organization admin using an API key',
        { ...organizationAdmin, apiKeyId: 'personal-key' },
      ],
    ])('refuses an invitation from %s', async (_, caller) => {
      expect((await invite(caller))._unsafeUnwrapErr()).toBeInstanceOf(
        ForbiddenError,
      )
    })

    it('lets an Auto Drive admin invite too', async () => {
      jest
        .spyOn(AuthManager, 'addOrganizationMember')
        .mockResolvedValue(ok(undefined))
      const invitation = (await invite(autoDriveAdmin))._unsafeUnwrap()

      expect(
        (
          await OrganizationsUseCases.acceptInvitation(outsider, invitation.id)
        ).isOk(),
      ).toBe(true)
    })

    it('keeps the invitation when its sender can\'t be looked up', async () => {
      jest
        .spyOn(AuthManager, 'addOrganizationMember')
        .mockResolvedValue(ok(undefined))
      const invitation = (await invite(autoDriveAdmin))._unsafeUnwrap()
      const lookup = jest
        .spyOn(AuthManager, 'getUserFromPublicId')
        .mockRejectedValueOnce(new Error('Failed to fetch user'))

      await expect(
        OrganizationsUseCases.acceptInvitation(outsider, invitation.id),
      ).rejects.toThrow('Failed to fetch user')
      expect(lookup).toHaveBeenCalledWith(autoDriveAdmin.publicId)

      // Once auth answers again, it can still be accepted.
      expect(
        (
          await OrganizationsUseCases.acceptInvitation(outsider, invitation.id)
        ).isOk(),
      ).toBe(true)
    })

    it.each<[string, [UserWithOrganization, OrganizationRole][]]>([
      ['demoted', [[organizationAdmin, OrganizationRole.Member]]],
      ['removed', []],
    ])('lapses once its sender is %s', async (_, senderMembership) => {
      const addMember = jest.spyOn(AuthManager, 'addOrganizationMember')
      const invitation = (await invite(organizationAdmin))._unsafeUnwrap()
      organization = {
        ...organization,
        memberships: memberships(
          [member, OrganizationRole.Admin],
          ...senderMembership,
        ),
      }

      const result = await OrganizationsUseCases.acceptInvitation(
        outsider,
        invitation.id,
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
      expect(addMember).not.toHaveBeenCalled()
      // It is revoked, so it no longer shows.
      expect(
        (
          await OrganizationsUseCases.getReceivedInvitations(outsider)
        )._unsafeUnwrap(),
      ).toEqual([])
    })

    it('leaves out an invitation to an organization the user is in', async () => {
      ;(await invite(organizationAdmin))._unsafeUnwrap()

      // An Auto Drive admin added them directly while it was open.
      const received = await OrganizationsUseCases.getReceivedInvitations({
        ...outsider,
        organizationId,
      })

      expect(received._unsafeUnwrap()).toEqual([])
    })

    it('refuses to invite a member or an unknown user', async () => {
      expect((await invite(organizationAdmin, member))._unsafeUnwrapErr())
        .toBeInstanceOf(ConflictError)
      jest
        .spyOn(AuthManager, 'getUserFromPublicId')
        .mockRejectedValue(new Error('Failed to fetch user'))
      expect(
        (await invite(organizationAdmin, createMockUser()))._unsafeUnwrapErr(),
      ).toBeInstanceOf(NotFoundError)
    })

    it('refuses to invite one of its partner end users', async () => {
      // In the organization, but left out of its memberships.
      const endUser = { ...createMockUser(), organizationId }
      jest
        .spyOn(AuthManager, 'getUserFromPublicId')
        .mockResolvedValue(endUser)

      expect(
        (await invite(organizationAdmin, endUser))._unsafeUnwrapErr(),
      ).toBeInstanceOf(ConflictError)
    })

    it('renews an open invitation rather than sending another', async () => {
      const first = (await invite(organizationAdmin))._unsafeUnwrap()
      const second = (
        await OrganizationsUseCases.inviteMember(
          organizationAdmin,
          organizationId,
          outsider.publicId,
          OrganizationRole.Admin,
        )
      )._unsafeUnwrap()

      expect(second.id).toBe(first.id)
      expect(second.role).toBe(OrganizationRole.Admin)
      expect(
        (
          await OrganizationsUseCases.getInvitations(
            organizationAdmin,
            organizationId,
          )
        )._unsafeUnwrap(),
      ).toHaveLength(1)
    })

    it('renews an invitation even with the most pending', async () => {
      const invitees = Array.from({ length: 50 }, () => createMockUser())
      jest
        .spyOn(AuthManager, 'getUserFromPublicId')
        .mockImplementation(
          async (publicId) => invitees.find((u) => u.publicId === publicId)!,
        )
      for (const invitee of invitees) {
        ;(await invite(organizationAdmin, invitee))._unsafeUnwrap()
      }

      expect((await invite(organizationAdmin, invitees[0])).isOk()).toBe(true)
      jest
        .spyOn(AuthManager, 'getUserFromPublicId')
        .mockResolvedValue(createMockUser())
      expect(
        (await invite(organizationAdmin, createMockUser()))._unsafeUnwrapErr(),
      ).toBeInstanceOf(ConflictError)
    })

    it('refuses to join an organization archived since the invitation', async () => {
      const addMember = jest.spyOn(AuthManager, 'addOrganizationMember')
      const invitation = (await invite(organizationAdmin))._unsafeUnwrap()
      organization = { ...organization, archivedAt: new Date().toISOString() }

      const result = await OrganizationsUseCases.acceptInvitation(
        outsider,
        invitation.id,
      )

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
      expect(addMember).not.toHaveBeenCalled()
    })

    it('can be accepted only by the invitee, signed in', async () => {
      const invitation = (await invite(organizationAdmin))._unsafeUnwrap()

      expect(
        (
          await OrganizationsUseCases.acceptInvitation(member, invitation.id)
        )._unsafeUnwrapErr(),
      ).toBeInstanceOf(NotFoundError)
      expect(
        (
          await OrganizationsUseCases.acceptInvitation(
            { ...outsider, apiKeyId: 'personal-key' },
            invitation.id,
          )
        )._unsafeUnwrapErr(),
      ).toBeInstanceOf(ForbiddenError)
    })

    it('is gone once revoked or declined', async () => {
      const revoked = (await invite(organizationAdmin))._unsafeUnwrap()
      ;(
        await OrganizationsUseCases.revokeInvitation(
          organizationAdmin,
          organizationId,
          revoked.id,
        )
      )._unsafeUnwrap()
      expect(
        (
          await OrganizationsUseCases.acceptInvitation(outsider, revoked.id)
        )._unsafeUnwrapErr(),
      ).toBeInstanceOf(NotFoundError)

      const declined = (await invite(organizationAdmin))._unsafeUnwrap()
      expect(declined.id).not.toBe(revoked.id)
      ;(
        await OrganizationsUseCases.declineInvitation(outsider, declined.id)
      )._unsafeUnwrap()
      expect(
        (
          await OrganizationsUseCases.getInvitations(
            organizationAdmin,
            organizationId,
          )
        )._unsafeUnwrap(),
      ).toEqual([])
    })

    it('asks the invitee to confirm leaving purchased credits behind', async () => {
      const addMember = jest
        .spyOn(AuthManager, 'addOrganizationMember')
        .mockResolvedValue(ok(undefined))
      const personal = await AccountsUseCases.getOrCreateAccount(outsider)
      const db = await getDatabase()
      const intentId = uuidv4()
      await db.query(
        `INSERT INTO intents (id, user_public_id, status, shannons_per_byte, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [intentId, outsider.publicId, IntentStatus.COMPLETED, '1', new Date()],
      )
      await purchasedCreditsRepository.createPurchasedCredit({
        accountId: personal.id,
        intentId,
        uploadBytesOriginal: 1_000n,
        downloadBytesOriginal: 0n,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      const invitation = (await invite(organizationAdmin))._unsafeUnwrap()

      const refused = await OrganizationsUseCases.acceptInvitation(
        outsider,
        invitation.id,
      )
      expect(refused._unsafeUnwrapErr()).toBeInstanceOf(UnusedCreditsError)
      expect(addMember).not.toHaveBeenCalled()

      const accepted = await OrganizationsUseCases.acceptInvitation(
        outsider,
        invitation.id,
        { allowUnusedCredits: true },
      )
      expect(accepted.isOk()).toBe(true)
      expect(addMember).toHaveBeenCalledTimes(1)
    })
  })

  describe('roles and removal', () => {
    beforeEach(() => {
      jest
        .spyOn(AuthManager, 'changeOrganizationMemberRole')
        .mockResolvedValue(ok(undefined))
      jest
        .spyOn(AuthManager, 'removeOrganizationMember')
        .mockResolvedValue(ok({ organizationId: uuidv4() }))
    })

    it('lets an organization admin promote and remove a member', async () => {
      expect(
        (
          await OrganizationsUseCases.changeMemberRole(
            organizationAdmin,
            organizationId,
            member.publicId,
            OrganizationRole.Admin,
          )
        ).isOk(),
      ).toBe(true)
      expect(
        (
          await OrganizationsUseCases.removeMember(
            organizationAdmin,
            organizationId,
            member.publicId,
          )
        ).isOk(),
      ).toBe(true)
    })

    it('refuses a member managing others', async () => {
      const result = await OrganizationsUseCases.removeMember(
        member,
        organizationId,
        organizationAdmin.publicId,
      )
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('keeps the organization from losing its last admin', async () => {
      const demoted = await OrganizationsUseCases.changeMemberRole(
        organizationAdmin,
        organizationId,
        organizationAdmin.publicId,
        OrganizationRole.Member,
      )
      const left = await OrganizationsUseCases.removeMember(
        organizationAdmin,
        organizationId,
        organizationAdmin.publicId,
      )
      expect(demoted._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
      expect(left._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)

      // With a second admin, either can step down.
      organization = {
        ...organization,
        memberships: memberships(
          [organizationAdmin, OrganizationRole.Admin],
          [member, OrganizationRole.Admin],
        ),
      }
      expect(
        (
          await OrganizationsUseCases.removeMember(
            organizationAdmin,
            organizationId,
            organizationAdmin.publicId,
          )
        ).isOk(),
      ).toBe(true)
    })

    it('lets an Auto Drive admin remove the last admin', async () => {
      const result = await OrganizationsUseCases.removeMember(
        autoDriveAdmin,
        organizationId,
        organizationAdmin.publicId,
      )
      expect(result.isOk()).toBe(true)
    })
  })

  describe('overview and files', () => {
    it('shows members their organization, and admins what they manage', async () => {
      const account =
        await accountsRepository.getByOrganizationId(organizationId)
      ;(
        await AccountsUseCases.updateAccount(
          autoDriveAdmin,
          account!.id,
          account!.model,
          account!.uploadLimit,
          account!.downloadLimit,
          { monthlyFreeUploadBytes: 1_000, reason: 'monthly allowance' },
        )
      )._unsafeUnwrap()
      ;(
        await AccountsUseCases.grantFreeCredits(autoDriveAdmin, account!.id, {
          uploadBytes: 250,
          expiresInDays: 30,
          reason: 'pilot',
        })
      )._unsafeUnwrap()

      const seen = (
        await OrganizationsUseCases.getOverview(member, organizationId)
      )._unsafeUnwrap()

      expect(seen).toMatchObject({
        name: 'Partner',
        accountId: account!.id,
        viewerRole: OrganizationRole.Member,
        canManageMembers: false,
        credits: {
          purchasedBytesRemaining: '0',
          // This month's allowance has been issued, apart from the grant.
          freeCreditBytesRemaining: '1250',
          monthlyFreeUploadBytes: '1000',
          monthlyFreeBytesRemaining: '1000',
          oneTimeFreeBytesRemaining: '250',
          oneTimeFreeBytesGranted: '250',
          oneTimeFreeGrantCount: 1,
        },
      })
      expect(seen.credits.oneTimeFreeNextExpiry).not.toBeNull()
      // Members see each other by public ID, never by sign-in name.
      expect(seen.members).toEqual([
        { publicId: organizationAdmin.publicId, role: OrganizationRole.Admin },
        { publicId: member.publicId, role: OrganizationRole.Member },
      ])
      expect(
        (
          await OrganizationsUseCases.getOverview(
            organizationAdmin,
            organizationId,
          )
        )._unsafeUnwrap().canManageMembers,
      ).toBe(true)
      expect(
        (
          await OrganizationsUseCases.getOverview(outsider, organizationId)
        )._unsafeUnwrapErr(),
      ).toBeInstanceOf(ForbiddenError)
    })

    it('lists the files of the organization\'s keys to its members', async () => {
      const getRootObjects = jest
        .spyOn(ObjectUseCases, 'getRootObjects')
        .mockResolvedValue({ rows: [], totalCount: 0 })

      const files = await OrganizationsUseCases.getFiles(
        member,
        organizationId,
        20,
        40,
      )

      expect(files._unsafeUnwrap()).toEqual({ rows: [], totalCount: 0 })
      expect(getRootObjects).toHaveBeenCalledWith(
        {
          scope: 'user',
          user: expect.objectContaining({
            oauthProvider: SERVICE_USER_PROVIDER,
            oauthUserId: organizationId,
            publicId: deriveUserPublicId(SERVICE_USER_PROVIDER, organizationId),
          }) as User,
        },
        20,
        40,
      )
      expect(
        (
          await OrganizationsUseCases.getFiles(outsider, organizationId, 20, 0)
        )._unsafeUnwrapErr(),
      ).toBeInstanceOf(ForbiddenError)
    })
  })
})
