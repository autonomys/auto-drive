import { Router, Request, Response } from 'express'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { AccountsUseCases } from '../../core/users/accounts.js'
import {
  USAGE_INTERACTIONS_CSV_HEADER,
  USAGE_REPORT_TABLES,
  UsageReportsUseCases,
} from '../../core/users/usageReports.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { AccountModel } from '@auto-drive/models'
import { z } from 'zod'

const logger = createLogger('http:controllers:accounts')

// A UTC instant: a date, or a date and time with Z or an offset.
const instant = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2}))?$/,
  )
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()))

const reportRange = z.object({ from: instant, to: instant })

const REPORT_RANGE_ERROR =
  '`from` and `to` must be ISO 8601 dates, or dates and times with Z or an offset'

const reportFileName = (
  report: { accountId: string; from: Date | string; to: Date | string },
  table: string,
) => {
  const day = (time: Date | string) => new Date(time).toISOString().slice(0, 10)
  return `usage-${report.accountId}-${day(report.from)}-${day(report.to)}-${table}.csv`
}

// Writes a chunk, waiting while the client is slow so a large export is not
// buffered in memory, or until it has gone.
const write = async (res: Response, chunk: string) => {
  if (res.write(chunk)) return
  await new Promise<void>((resolve) => {
    const done = () => {
      res.off('drain', done)
      res.off('close', done)
      resolve()
    }
    res.on('drain', done)
    res.on('close', done)
  })
}

export const accountController = Router()

accountController.get(
  '/@me',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const accountInfo = await handleInternalError(
      AccountsUseCases.getAccountInfo(user),
      'Failed to get account info',
    )
    if (accountInfo.isErr()) {
      logger.error('Failed to get account info', accountInfo.error)
      handleError(accountInfo.error, res)
      return
    }

    logger.trace('account info', accountInfo.value)
    res.json(accountInfo.value)
  }),
)

accountController.post(
  '/list',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const userPublicIds = z
      .array(z.string())
      .max(100)
      .safeParse(req.body.userPublicIds)
    if (!userPublicIds.success) {
      res
        .status(400)
        .json({ error: 'userPublicIds must be an array of strings' })
      return
    }

    const accountByPublicId = await handleInternalErrorResult(
      AccountsUseCases.getUserListAccount(user, userPublicIds.data),
      'Failed to get user list accounts',
    )
    if (accountByPublicId.isErr()) {
      logger.error('Failed to get user list accounts', accountByPublicId.error)
      handleError(accountByPublicId.error, res)
      return
    }

    logger.trace('User list accounts', accountByPublicId.value)
    res.json(accountByPublicId.value)
  }),
)

// Admin-only: find accounts by partial user publicId, account ID or
// organization ID. Each result carries the matching user.
accountController.get(
  '/admin/search',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!query) {
      res.status(400).json({ error: 'Missing query parameter `q`' })
      return
    }

    const result = await handleInternalErrorResult(
      AccountsUseCases.adminSearchAccounts(user, query),
      'Failed to search accounts',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

// Admin-only: each user's current account ID, keyed by publicId.
accountController.post(
  '/admin/by-users',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const publicIds = z.array(z.string()).max(100).safeParse(req.body.publicIds)
    if (!publicIds.success) {
      res.status(400).json({ error: 'publicIds must be an array of strings' })
      return
    }

    const result = await handleInternalErrorResult(
      AccountsUseCases.adminGetAccountIdsByUsers(user, publicIds.data),
      'Failed to get accounts by users',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

// Admin-only: the account of an organization, with its members.
accountController.get(
  '/admin/by-organization/:organizationId',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      AccountsUseCases.adminGetAccountByOrganization(
        user,
        req.params.organizationId,
      ),
      'Failed to get account',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

// Admin-only: the history of changes to an account's terms.
accountController.get(
  '/admin/:id/terms-changes',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      AccountsUseCases.adminGetTermsChanges(user, req.params.id),
      'Failed to get account terms changes',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

// Admin-only: headline usage figures for each account with activity in
// [from, to), most upload bytes first. `partnersOnly=true` lists partner
// accounts only.
accountController.get(
  '/admin/usage',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const query = reportRange
      .extend({
        partnersOnly: z.enum(['true', 'false']).default('false'),
        limit: z.coerce.number().int().min(1).max(1000).default(100),
      })
      .safeParse(req.query)
    if (!query.success) {
      res.status(400).json({ error: REPORT_RANGE_ERROR })
      return
    }

    const { from, to, partnersOnly, limit } = query.data
    const result = await handleInternalErrorResult(
      UsageReportsUseCases.adminGetAccountUsageSummaries(
        user,
        { from, to },
        { partnersOnly: partnersOnly === 'true', limit },
      ),
      'Failed to get account usage',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

// Admin-only: one account by account ID, with its members.
accountController.get(
  '/admin/:id',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      AccountsUseCases.adminGetAccount(user, req.params.id),
      'Failed to get account',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

// The account's usage over [from, to), for members of its organisation and
// Auto Drive admins: JSON, or one of its tables as CSV
// (`format=csv&table=summary|apiKeys|purchases`).
accountController.get(
  '/:accountId/usage-report',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const query = reportRange
      .extend({
        format: z.enum(['json', 'csv']).default('json'),
        table: z.enum(USAGE_REPORT_TABLES).optional(),
      })
      .refine((q) => q.format === 'json' || !!q.table)
      .safeParse(req.query)
    if (!query.success) {
      res.status(400).json({
        error: `${REPORT_RANGE_ERROR}; format=csv needs table=${USAGE_REPORT_TABLES.join('|')}`,
      })
      return
    }

    const { from, to, format, table } = query.data
    const result = await handleInternalErrorResult(
      UsageReportsUseCases.getUsageReport(user, req.params.accountId, {
        from,
        to,
      }),
      'Failed to get usage report',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    if (format === 'json' || !table) {
      res.json(result.value)
      return
    }
    res
      .type('text/csv')
      .attachment(reportFileName(result.value, table))
      .send(UsageReportsUseCases.usageReportCsv(result.value, table))
  }),
)

// Every interaction behind the usage report, oldest first, streamed as JSON
// (an array) or CSV (`format=csv`).
accountController.get(
  '/:accountId/usage-report/interactions',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const query = reportRange
      .extend({ format: z.enum(['json', 'csv']).default('json') })
      .safeParse(req.query)
    if (!query.success) {
      res.status(400).json({ error: REPORT_RANGE_ERROR })
      return
    }

    const { from, to, format } = query.data
    const result = await handleInternalErrorResult(
      UsageReportsUseCases.getUsageInteractions(user, req.params.accountId, {
        from,
        to,
      }),
      'Failed to get usage interactions',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    const csv = format === 'csv'
    if (csv) {
      res
        .type('text/csv')
        .attachment(
          reportFileName(
            { accountId: req.params.accountId, ...result.value },
            'interactions',
          ),
        )
    } else {
      res.type('application/json')
    }

    // Headers are sent with the first write, so a failure after it can only
    // cut the response short.
    try {
      await write(res, csv ? USAGE_INTERACTIONS_CSV_HEADER : '[')
      let first = true
      for await (const page of result.value.pages) {
        if (res.destroyed) return
        const chunk = csv
          ? UsageReportsUseCases.usageInteractionsCsv(page)
          : page.map((i) => JSON.stringify(i)).join(',')
        await write(res, first || csv ? chunk : `,${chunk}`)
        first = false
      }
      res.end(csv ? undefined : ']')
    } catch (error) {
      logger.error(error, 'Failed to stream usage interactions')
      res.destroy(error as Error)
    }
  }),
)

accountController.get(
  '/ranking',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10
    const type = req.query.type === 'download' ? 'download' : 'upload'

    const fromDate = req.query.from
      ? new Date(parseInt(req.query.from as string))
      : null
    const toDate = req.query.to
      ? new Date(parseInt(req.query.to as string))
      : null

    if (fromDate && toDate && fromDate >= toDate) {
      return res.status(400).json({ error: 'Invalid date range' })
    }

    const accounts = await handleInternalError(
      AccountsUseCases.getTopAccounts(user, {
        limit,
        fromDate,
        toDate,
        type,
      }),
      'Failed to get top accounts',
    )
    if (accounts.isErr()) {
      logger.error('Failed to get top accounts', accounts.error)
      handleError(accounts.error, res)
      return
    }

    res.json(accounts.value)
  }),
)

accountController.post(
  '/update',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const executor = await handleAuth(req, res)
    if (!executor) {
      return
    }

    const { accountId, uploadLimit, downloadLimit, model } = req.body

    if (typeof accountId !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid attribute `accountId` in body',
      })
      return
    }

    if (typeof uploadLimit !== 'number') {
      res.status(400).json({
        error: 'Missing or invalid attribute `uploadLimit` in body',
      })
      return
    }

    if (typeof downloadLimit !== 'number') {
      res.status(400).json({
        error: 'Missing or invalid attribute `downloadLimit` in body',
      })
      return
    }

    const safeModel = z.nativeEnum(AccountModel).safeParse(model)
    if (!safeModel.success) {
      res.status(400).json({
        error: 'Invalid model',
      })
      return
    }

    // Overrides of the global credit terms; null clears one.
    const terms = z
      .object({
        maxPurchasedBytes: z
          .number()
          .int()
          .positive()
          .safe()
          .nullable()
          .optional(),
        creditExpiryDays: z
          .number()
          .int()
          .positive()
          .max(36500)
          .nullable()
          .optional(),
        reason: z.string().trim().max(500).optional(),
      })
      .safeParse(req.body)
    if (!terms.success) {
      res.status(400).json({
        error:
          'Invalid `maxPurchasedBytes`, `creditExpiryDays` or `reason` in body',
      })
      return
    }

    const updateResult = await handleInternalErrorResult(
      AccountsUseCases.updateAccount(
        executor,
        accountId,
        safeModel.data,
        uploadLimit,
        downloadLimit,
        terms.data,
      ),
      'Failed to update account',
    )
    if (updateResult.isErr()) {
      logger.error('Failed to update account', updateResult.error)
      handleError(updateResult.error, res)
      return
    }

    logger.debug('Account updated', updateResult.value)
    res.json(updateResult.value)
  }),
)
