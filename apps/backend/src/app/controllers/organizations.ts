import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { OrganizationRole } from '@auto-drive/models'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { OrganizationsUseCases } from '../../core/users/organizations.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleInternalErrorResult } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'

// Admin-only: partner organizations and their members. Every route checks the
// admin role in its use case.
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
      .object({ publicId: z.string().min(1), role: roleSchema })
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

organizationsController.patch(
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
