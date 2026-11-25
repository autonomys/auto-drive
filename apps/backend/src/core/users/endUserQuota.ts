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

type EndUserEvent = 'enrolled' | 'uploaded' | 'quota_refused'

/**
 * Counts what partner end users do, for alerting (#995): enrolments (`count`
 * people), uploads (`bytes`) and the uploads their quota refused.
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
 * lockEndUserQuota, to check it race-free.
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
 * Serialises a partner end user's uploads until the transaction ends, so two
 * at once can't both pass their quota.
 */
export const lockEndUserQuota = async (
  user: UserWithOrganization,
  account: Account,
  executor: Executor,
): Promise<void> => {
  if (!isPartnerEndUser(user)) return
  await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `end-user-quota:${account.id}:${stampCustomerReference(user, null)}`,
  ])
}
