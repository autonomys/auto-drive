import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { ApiKeyScope, MEMBER_ROLES } from '@auto-drive/models'
import {
  handleAuth,
  requireApiKeyScope,
} from '../../infrastructure/services/auth/express.js'
import { OrganizationsUseCases } from '../../core/users/organizations.js'
import { EndUsersUseCases } from '../../core/users/endUsers.js'
import { CUSTOMER_REFERENCE } from '../../core/uploads/customerReference.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleInternalErrorResult } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'

// Partner organizations, their members, their API keys and their end users.
// Every route checks its caller in its use case: Auto Drive admins manage
// organizations, organization admins manage their members (by invitation) and
// API keys, members read their organization, and organization admins and the
// organization's API keys manage its end users.
export const organizationsController = Router()

const roleSchema = z.enum(MEMBER_ROLES)

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
        error: `publicId and role (${MEMBER_ROLES.join(', ')}) are required`,
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
        error: `publicId and role (${MEMBER_ROLES.join(', ')}) are required`,
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
        error: `role must be one of: ${MEMBER_ROLES.join(', ')}`,
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

    // Auth validates the name's length, that the expiry is in the future and
    // that the scopes are neither empty nor repeated. Without scopes the key
    // has full access.
    const body = z
      .object({
        name: z.string().nullish(),
        expiresAt: z.string().nullish(),
        scopes: z.array(z.nativeEnum(ApiKeyScope)).nullish(),
      })
      .safeParse(req.body ?? {})
    if (!body.success) {
      res.status(400).json({
        error: `name and expiresAt must be strings, and scopes a list of: ${Object.values(ApiKeyScope).join(', ')}`,
      })
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

const enrollEndUsersBody = z.object({
  endUsers: z
    .array(
      z.object({
        address: z.string(),
        customerReference: z.string().regex(CUSTOMER_REFERENCE),
        uploadQuotaBytes: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .nullish(),
      }),
    )
    .min(1)
    .max(100),
})

organizationsController.post(
  '/:organizationId/end-users',
  requireApiKeyScope(ApiKeyScope.EndUsers),
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const body = enrollEndUsersBody.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({
        error:
          'endUsers must be a list of 1 to 100 { address, customerReference, ' +
          'uploadQuotaBytes? }: customerReference 1 to 128 letters, digits, ' +
          '"-", "_", "." or ":", and uploadQuotaBytes a positive integer',
      })
      return
    }

    const result = await handleInternalErrorResult(
      EndUsersUseCases.enrollEndUsers(
        user,
        req.params.organizationId,
        body.data.endUsers,
      ),
      'Failed to enroll end users',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(201).json({ endUsers: result.value })
  }),
)

const listEndUsersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

organizationsController.get(
  '/:organizationId/end-users',
  requireApiKeyScope(ApiKeyScope.EndUsers),
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const query = listEndUsersQuery.safeParse(req.query)
    if (!query.success) {
      res.status(400).json({
        error: 'limit must be 1 to 500 and offset a non-negative integer',
      })
      return
    }

    const result = await handleInternalErrorResult(
      EndUsersUseCases.listEndUsers(
        user,
        req.params.organizationId,
        query.data,
      ),
      'Failed to list end users',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

organizationsController.delete(
  '/:organizationId/end-users/:address',
  requireApiKeyScope(ApiKeyScope.EndUsers),
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      EndUsersUseCases.removeEndUser(
        user,
        req.params.organizationId,
        req.params.address,
      ),
      'Failed to remove end user',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(204).end()
  }),
)
