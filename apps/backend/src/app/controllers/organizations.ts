import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { OrganizationRole } from '@auto-drive/models'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { OrganizationsUseCases } from '../../core/users/organizations.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleInternalErrorResult } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'

// Partner organizations, their members and their API keys. Every route checks
// its caller in its use case: Auto Drive admins manage organizations,
// organization admins manage their members (by invitation) and API keys, and
// members read their organization.
export const organizationsController = Router()

const roleSchema = z.nativeEnum(OrganizationRole)

organizationsController.get(
  '/partners',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.listPartnerOrganizations(user),
      'Failed to list partner organizations',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

organizationsController.post(
  '/partners',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const name = z.string().safeParse(req.body?.name)
    if (!name.success) {
      res.status(400).json({ error: 'name must be a string' })
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.createPartnerOrganization(user, name.data),
      'Failed to create partner organization',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(201).json(result.value)
  }),
)

// Registered before the `/:organizationId` routes, which would otherwise read
// `invitations` as an organization ID.
organizationsController.get(
  '/invitations/received',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.getReceivedInvitations(user),
      'Failed to get invitations',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

organizationsController.post(
  '/invitations/:invitationId/accept',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const body = z
      .object({ allowUnusedCredits: z.boolean().optional() })
      .safeParse(req.body ?? {})
    if (!body.success) {
      res.status(400).json({ error: 'allowUnusedCredits must be a boolean' })
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.acceptInvitation(user, req.params.invitationId, {
        allowUnusedCredits: body.data.allowUnusedCredits,
      }),
      'Failed to accept invitation',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

organizationsController.post(
  '/invitations/:invitationId/decline',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.declineInvitation(user, req.params.invitationId),
      'Failed to decline invitation',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(204).end()
  }),
)

organizationsController.get(
  '/:organizationId/overview',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.getOverview(user, req.params.organizationId),
      'Failed to get organization',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

organizationsController.get(
  '/:organizationId/files',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const page = pageSchema.safeParse(req.query)
    if (!page.success) {
      res.status(400).json({
        error: 'limit must be 1 to 100 and offset a non-negative integer',
      })
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.getFiles(
        user,
        req.params.organizationId,
        page.data.limit,
        page.data.offset,
      ),
      'Failed to get organization files',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

organizationsController.get(
  '/:organizationId/invitations',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.getInvitations(user, req.params.organizationId),
      'Failed to get invitations',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

organizationsController.post(
  '/:organizationId/invitations',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const body = z
      .object({ publicId: z.string().trim().min(1), role: roleSchema })
      .safeParse(req.body)
    if (!body.success) {
      res.status(400).json({
        error: `publicId and role (${Object.values(OrganizationRole).join(', ')}) are required`,
      })
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.inviteMember(
        user,
        req.params.organizationId,
        body.data.publicId,
        body.data.role,
      ),
      'Failed to invite member',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(201).json(result.value)
  }),
)

organizationsController.delete(
  '/:organizationId/invitations/:invitationId',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.revokeInvitation(
        user,
        req.params.organizationId,
        req.params.invitationId,
      ),
      'Failed to revoke invitation',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(204).end()
  }),
)

organizationsController.get(
  '/:organizationId/membership-changes',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.getMembershipChanges(
        user,
        req.params.organizationId,
      ),
      'Failed to get membership changes',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

organizationsController.post(
  '/:organizationId/members',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const body = z
      .object({
        publicId: z.string().min(1),
        role: roleSchema,
        allowUnusedCredits: z.boolean().optional(),
      })
      .safeParse(req.body)
    if (!body.success) {
      res.status(400).json({
        error: `publicId and role (${Object.values(OrganizationRole).join(', ')}) are required`,
      })
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.addMember(
        user,
        req.params.organizationId,
        body.data.publicId,
        body.data.role,
        { allowUnusedCredits: body.data.allowUnusedCredits },
      ),
      'Failed to add member',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(204).end()
  }),
)

organizationsController.put(
  '/:organizationId/members/:publicId',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const role = roleSchema.safeParse(req.body?.role)
    if (!role.success) {
      res.status(400).json({
        error: `role must be one of: ${Object.values(OrganizationRole).join(', ')}`,
      })
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.changeMemberRole(
        user,
        req.params.organizationId,
        req.params.publicId,
        role.data,
      ),
      'Failed to change member role',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(204).end()
  }),
)

organizationsController.delete(
  '/:organizationId/members/:publicId',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.removeMember(
        user,
        req.params.organizationId,
        req.params.publicId,
      ),
      'Failed to remove member',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

organizationsController.get(
  '/:organizationId/api-keys',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.listApiKeys(user, req.params.organizationId),
      'Failed to list API keys',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

organizationsController.post(
  '/:organizationId/api-keys',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    // Auth validates the name's length and that the expiry is in the future.
    const body = z
      .object({
        name: z.string().nullish(),
        expiresAt: z.string().nullish(),
      })
      .safeParse(req.body ?? {})
    if (!body.success) {
      res.status(400).json({ error: 'name and expiresAt must be strings' })
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.createApiKey(
        user,
        req.params.organizationId,
        body.data,
      ),
      'Failed to create API key',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(201).json(result.value)
  }),
)

organizationsController.delete(
  '/:organizationId/api-keys/:apiKeyId',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      OrganizationsUseCases.revokeApiKey(
        user,
        req.params.organizationId,
        req.params.apiKeyId,
      ),
      'Failed to revoke API key',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(204).end()
  }),
)
