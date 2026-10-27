import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('services:slack')

const SEND_TIMEOUT_MS = 10_000

export interface SlackMessage {
  /** Single-line summary, used as the message text. */
  title: string
  /** Optional detail block, rendered as a fenced code block. */
  details?: string
}

const isEnabled = () => Boolean(config.slack.webhookUrl)

/**
 * Posts to a Slack incoming webhook.
 *
 * Never throws: alerting is best-effort and must not fail the work that
 * triggered it. Returns whether the post succeeded so callers can log or count
 * it, but the failure of an alert is never itself escalated — there is nowhere
 * to escalate it to.
 */
const send = async (message: SlackMessage): Promise<boolean> => {
  const webhookUrl = config.slack.webhookUrl
  if (!webhookUrl) {
    logger.debug('Slack alerting disabled (no SLACK_WEBHOOK_URL); dropping alert')
    return false
  }

  const text = [
    message.title,
    message.details ? `\`\`\`\n${message.details}\n\`\`\`` : null,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })

    if (!response.ok) {
      // Body is read for the log because Slack returns the reason in plain text
      // ("invalid_payload", "channel_not_found") rather than in the status.
      const body = await response.text().catch(() => '<unreadable>')
      logger.warn(
        'Slack webhook rejected the alert (status=%d): %s',
        response.status,
        body,
      )
      return false
    }

    return true
  } catch (error) {
    logger.warn(error as Error, 'Failed to post Slack alert')
    return false
  }
}

export const slackNotifier = {
  isEnabled,
  send,
}
