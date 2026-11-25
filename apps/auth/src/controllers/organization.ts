import { Router, Request, Response } from 'express'
import {
  EndUserEnrollment,
  OrganizationsUseCases,
  PartnerOriginsUseCases,
} from '../useCases/index.js'
import { createLogger } from '../drivers/logger.js'
import {
  handleAdminAuth,
  handleServiceAuth,
} from '../services/authManager/express.js'
import { OrganizationError } from '../errors/organizations.js'
import { ApiKeyError } from '../errors/apikeys.js'
import { parseCreateApiKeyBody } from './apiKeyBody.js'

const logger = createLogger('http:controllers:organization')

export const organizationController = Router()

const handleError = (error: unknown, res: Response, message: string) => {
  if (error instanceof OrganizationError || error instanceof ApiKeyError) {
    res.status(error.httpStatus).json({ error: error.message })
    return
  }
  logger.error(error)
  res.status(500).json({ error: message })
}

// Every membership write below records who made it: the Auto Drive admin, or
// for partner end users the organisation admin or organisation API key.
const getActor = (req: Request, res: Response): string | null => {
  const actor = req.body?.actor
  if (typeof actor !== 'string' || !actor) {
    res.status(400).json({ error: 'actor is required' })
    return null
  }
  return actor
}

organizationController.post('/', async (req: Request, res: Response) => {
  if (!handleServiceAuth(req, res)) {
    return
  }

  const { name } = req.body ?? {}
  if (typeof name !== 'string') {
    res.status(400).json({ error: 'name must be a string' })
    return
  }

  try {
    res.status(201).json(await OrganizationsUseCases.createOrganization(name))
  } catch (error) {
    handleError(error, res, 'Failed to create organization')
  }
})

organizationController.post('/batch', async (req: Request, res: Response) => {
  if (!handleServiceAuth(req, res)) {
    return
  }

  const { ids } = req.body ?? {}
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    !ids.every((id) => typeof id === 'string')
  ) {
    res.status(400).json({ error: 'ids must be an array of up to 100 strings' })
    return
  }

  try {
    res.json(await OrganizationsUseCases.getOrganizationSummaries(ids))
  } catch (error) {
    handleError(error, res, 'Failed to get organizations')
  }
})

organizationController.get(
  '/:organizationId',
  async (req: Request, res: Response) => {
    const isAdmin = await handleAdminAuth(req, res)
    if (!isAdmin) {
      return
    }

    const { organizationId } = req.params
    try {
      const organization =
        await OrganizationsUseCases.getOrganization(organizationId)
      res.json(organization)
    } catch (error) {
      handleError(error, res, 'Failed to get organization')
    }
  },
)

organizationController.get(
  '/:organizationId/membership-changes',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }

    try {
      res.json(
        await OrganizationsUseCases.getMembershipChanges(
          req.params.organizationId,
        ),
      )
    } catch (error) {
      handleError(error, res, 'Failed to get membership changes')
    }
  },
)

organizationController.post(
  '/:organizationId/members',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }
    const actor = getActor(req, res)
    if (!actor) {
      return
    }

    const { publicId, role } = req.body
    if (typeof publicId !== 'string') {
      res.status(400).json({ error: 'publicId must be a string' })
      return
    }

    try {
      await OrganizationsUseCases.addMember({
        organizationId: req.params.organizationId,
        publicId,
        role,
        actor,
      })
      res.status(204).end()
    } catch (error) {
      handleError(error, res, 'Failed to add member')
    }
  },
)

organizationController.put(
  '/:organizationId/members/:publicId',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }
    const actor = getActor(req, res)
    if (!actor) {
      return
    }

    try {
      await OrganizationsUseCases.changeMemberRole({
        organizationId: req.params.organizationId,
        publicId: req.params.publicId,
        role: req.body.role,
        actor,
      })
      res.status(204).end()
    } catch (error) {
      handleError(error, res, 'Failed to change member role')
    }
  },
)

organizationController.delete(
  '/:organizationId/members/:publicId',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }
    const actor = getActor(req, res)
    if (!actor) {
      return
    }

    try {
      res.json(
        await OrganizationsUseCases.removeMember({
          organizationId: req.params.organizationId,
          publicId: req.params.publicId,
          actor,
        }),
      )
    } catch (error) {
      handleError(error, res, 'Failed to remove member')
    }
  },
)

// The organisation API key behind an end-user change, if one made it.
const getActorApiKeyId = (
  req: Request,
  res: Response,
): string | null | false => {
  const actorApiKeyId = req.body?.actorApiKeyId ?? null
  if (
    actorApiKeyId !== null &&
    (typeof actorApiKeyId !== 'string' || !actorApiKeyId)
  ) {
    res.status(400).json({ error: 'actorApiKeyId must be a string or null' })
    return false
  }
  return actorApiKeyId
}

// A partner's end users. The backend decides who may manage them and checks
// what the partner gives for them; these routes check its shape.
const isEnrollment = (value: unknown): value is EndUserEnrollment => {
  const { address, customerReference, uploadQuotaBytes } = (value ??
    {}) as Record<string, unknown>
  return (
    typeof address === 'string' &&
    typeof customerReference === 'string' &&
    customerReference.length >= 1 &&
    customerReference.length <= 128 &&
    (uploadQuotaBytes == null ||
      (Number.isSafeInteger(uploadQuotaBytes) && Number(uploadQuotaBytes) > 0))
  )
}

organizationController.post(
  '/:organizationId/end-users',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }
    const actor = getActor(req, res)
    if (!actor) {
      return
    }
    const actorApiKeyId = getActorApiKeyId(req, res)
    if (actorApiKeyId === false) {
      return
    }

    const { endUsers, maxEndUsers } = req.body
    if (
      !Array.isArray(endUsers) ||
      endUsers.length < 1 ||
      endUsers.length > 100 ||
      !endUsers.every(isEnrollment)
    ) {
      res.status(400).json({
        error:
          'endUsers must be an array of 1 to 100 { address, customerReference, uploadQuotaBytes }',
      })
      return
    }
    if (!Number.isSafeInteger(maxEndUsers) || maxEndUsers < 0) {
      res
        .status(400)
        .json({ error: 'maxEndUsers must be a non-negative integer' })
      return
    }

    try {
      res.json(
        await OrganizationsUseCases.enrollEndUsers({
          organizationId: req.params.organizationId,
          endUsers: endUsers.map((endUser) => ({
            address: endUser.address,
            customerReference: endUser.customerReference,
            uploadQuotaBytes: endUser.uploadQuotaBytes ?? null,
          })),
          maxEndUsers,
          actor,
          actorApiKeyId,
        }),
      )
    } catch (error) {
      handleError(error, res, 'Failed to enroll end users')
    }
  },
)

// A non-negative integer query parameter, or null if it is not one.
const parseCount = (value: unknown, fallback: number): number | null => {
  if (value === undefined) return fallback
  return typeof value === 'string' && /^\d{1,9}$/.test(value)
    ? Number(value)
    : null
}

organizationController.get(
  '/:organizationId/end-users',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }

    const limit = parseCount(req.query.limit, 100)
    const offset = parseCount(req.query.offset, 0)
    if (limit === null || limit < 1 || limit > 500 || offset === null) {
      res.status(400).json({
        error: 'limit must be 1 to 500 and offset a non-negative integer',
      })
      return
    }

    try {
      res.json(
        await OrganizationsUseCases.listEndUsers({
          organizationId: req.params.organizationId,
          limit,
          offset,
        }),
      )
    } catch (error) {
      handleError(error, res, 'Failed to list end users')
    }
  },
)

organizationController.delete(
  '/:organizationId/end-users/:address',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }
    const actor = getActor(req, res)
    if (!actor) {
      return
    }
    const actorApiKeyId = getActorApiKeyId(req, res)
    if (actorApiKeyId === false) {
      return
    }

    try {
      await OrganizationsUseCases.removeEndUser({
        organizationId: req.params.organizationId,
        address: req.params.address,
        actor,
        actorApiKeyId,
      })
      res.status(204).end()
    } catch (error) {
      handleError(error, res, 'Failed to remove end user')
    }
  },
)

// The origins of a partner's app that its end users sign in for. The backend
// lets Auto Drive admins manage them.
organizationController.get(
  '/:organizationId/partner-origins',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }

    try {
      res.json(
        await PartnerOriginsUseCases.listOrigins(req.params.organizationId),
      )
    } catch (error) {
      handleError(error, res, 'Failed to list partner origins')
    }
  },
)

organizationController.post(
  '/:organizationId/partner-origins',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }
    const actor = getActor(req, res)
    if (!actor) {
      return
    }
    const { origin } = req.body
    if (typeof origin !== 'string') {
      res.status(400).json({ error: 'origin must be a string' })
      return
    }

    try {
      res.status(201).json(
        await PartnerOriginsUseCases.addOrigin({
          organizationId: req.params.organizationId,
          origin,
          actor,
        }),
      )
    } catch (error) {
      handleError(error, res, 'Failed to add partner origin')
    }
  },
)

// The origin is URL-encoded in the path.
organizationController.delete(
  '/:organizationId/partner-origins/:origin',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }

    try {
      await PartnerOriginsUseCases.removeOrigin({
        organizationId: req.params.organizationId,
        origin: req.params.origin,
      })
      res.status(204).end()
    } catch (error) {
      handleError(error, res, 'Failed to remove partner origin')
    }
  },
)

// The organisation's API keys. The backend decides who may manage them.
organizationController.get(
  '/:organizationId/apiKeys',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }

    try {
      res.json(
        await OrganizationsUseCases.listApiKeys(req.params.organizationId),
      )
    } catch (error) {
      handleError(error, res, 'Failed to get API keys')
    }
  },
)

organizationController.post(
  '/:organizationId/apiKeys',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }

    const parsed = parseCreateApiKeyBody(req.body, { organization: true })
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error })
      return
    }

    try {
      res
        .status(201)
        .json(
          await OrganizationsUseCases.createApiKey(
            req.params.organizationId,
            parsed,
          ),
        )
    } catch (error) {
      handleError(error, res, 'Failed to create API key')
    }
  },
)

organizationController.delete(
  '/:organizationId/apiKeys/:apiKeyId',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }

    try {
      await OrganizationsUseCases.revokeApiKey(
        req.params.organizationId,
        req.params.apiKeyId,
      )
      res.status(204).end()
    } catch (error) {
      handleError(error, res, 'Failed to revoke API key')
    }
  },
)
