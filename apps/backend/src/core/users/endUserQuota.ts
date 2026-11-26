import {
  Account,
  UserWithOrganization,
  isPartnerEndUser,
} from '@auto-drive/models'
import { interactionsRepository } from '../../infrastructure/repositories/objects/interactions.js'
import { Executor } from '../../infrastructure/drivers/pg.js'
import { sendMetricToVictoria } from '../../infrastructure/drivers/vmetrics.js'
import { PaymentRequiredError } from '../../errors/index.js'
import { stampCustomerReference } from '../uploads/customerReference.js'
import { config } from '../../config.js'

type EndUserEvent =
  | 'enrolled'
  | 'uploaded'
  | 'quota_refused'
  | 'daily_limit_refused'

/**
 * Counts what partner end users do, for alerting (#995): enrolments (`count`
 * people), uploads (`bytes`), the uploads their quota refused and the uploads
 * the account's daily upload limit refused (anyone's, staff included).
 */
export const sendEndUserMetric = (
  organizationId: string,
  event: EndUserEvent,
  fields: { count: number; bytes?: bigint },
): void => {
  sendMetricToVictoria({
    measurement: 'auto_drive_partner_end_users',
    tags: {
      chain: config.monitoring.metricEnvironmentTag,
      organization_id: organizationId,
      event,
    },
    fields,
  })
}

/**
 * A partner end user's upload quota: their own if the partner set one,
 * otherwise the account's per-person maximum, and never more than that
 * maximum, so lowering it applies to everyone already enrolled.
 */
export const effectiveQuotaBytes = (
  user: Pick<UserWithOrganization, 'uploadQuotaBytes'>,
  account: Pick<Account, 'maxEndUserQuotaBytes'>,
): bigint => {
  const max = BigInt(account.maxEndUserQuotaBytes)
  const own = user.uploadQuotaBytes
  return own != null && BigInt(own) < max ? BigInt(own) : max
}

/**
 * Refuses, with a 402, an upload of `bytes` that would take a partner end
 * user past their quota, or with `bytes` null (the size is not known yet) one
 * from an end user who has none left. The quota is a total: every byte they
 * ever uploaded counts, removed files included. Does nothing for anyone else.
 * Pass the transaction that charges the upload, which must hold
 * accountsRepository.lockForUploads, to check it race-free.
 */
export const checkEndUserQuota = async (
  user: UserWithOrganization,
  account: Account,
  bytes: bigint | null,
  executor?: Executor,
): Promise<void> => {
  if (!isPartnerEndUser(user)) return

  const quota = effectiveQuotaBytes(user, account)
  const used = await interactionsRepository.getUploadedBytesByCustomerReference(
    account.id,
    stampCustomerReference(user, null) as string,
    executor,
  )
  if (bytes === null ? used >= quota : used + bytes > quota) {
    sendEndUserMetric(account.organizationId, 'quota_refused', { count: 1 })
    throw new PaymentRequiredError(
      `This upload would exceed the end user's upload quota of ${quota} ` +
        `bytes (${used} bytes used)`,
    )
  }
}

/**
 * Refuses, with a 402, an upload of `bytes` that would take the account past
 * its daily upload limit in the last 24 hours, or with `bytes` null (the size
 * is not known yet) one to an account with none of it left. The limit counts
 * every upload charged to the account. Until a partner's admins set it or
 * switch it off, the account's end users can't upload at all, and everyone
 * else uploads as before. Pass the transaction that charges the upload, which
 * must hold accountsRepository.lockForUploads, to check it race-free.
 */
export const checkDailyUploadLimit = async (
  user: UserWithOrganization,
  account: Account,
  bytes: bigint | null,
  executor?: Executor,
): Promise<void> => {
  if (account.dailyUploadLimitOff) return
  if (account.dailyUploadLimitBytes === null) {
    if (!isPartnerEndUser(user)) return
    sendEndUserMetric(account.organizationId, 'daily_limit_refused', {
      count: 1,
    })
    throw new PaymentRequiredError(
      'The organization\'s admins haven\'t set its daily upload limit yet',
    )
  }

  const limit = BigInt(account.dailyUploadLimitBytes)
  const used = await interactionsRepository.getUploadedBytesInLast24Hours(
    account.id,
    executor,
  )
  if (bytes === null ? used >= limit : used + bytes > limit) {
    sendEndUserMetric(account.organizationId, 'daily_limit_refused', {
      count: 1,
    })
    throw new PaymentRequiredError(
      'This upload would exceed the account\'s daily upload limit of ' +
        `${limit} bytes (${used} bytes uploaded in the last 24 hours)`,
    )
  }
}
