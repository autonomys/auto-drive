import { Router } from 'express'
import type { UsdcAvailability } from '@auto-drive/models'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { UsdcPaymentsUseCases } from '../../core/payments/usdc.js'
import { handleInternalErrorResult } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('controllers:payments')

export const paymentsController = Router()

// ---------------------------------------------------------------------------
// GET /payments/usdc/status
//
// Admin-only. Every gate, why it is where it is, and what it would take to
// change it: the manual switch and who last flipped it, the treasury balance
// against its cap with the age of that reading, and the oracle's health.
//
// All three, always — a closed payment path must never be a mystery, and "which
// one is it" is the first question anyone asks.
// ---------------------------------------------------------------------------

paymentsController.get(
  '/usdc/status',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      UsdcPaymentsUseCases.getStatus(user),
      'Failed to read USDC payment status',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// POST /payments/usdc/enable
// POST /payments/usdc/disable
//
// Admin-only, idempotent, attributed. Two routes rather than one with a body,
// because a mistyped payload must not be able to mean "enable" — and the audit
// line reads better for it.
//
// `changed` says whether this call was the transition (and therefore whether it
// alerted), so a dashboard can distinguish "you turned it off" from "it was
// already off".
//
// Scope, deliberately: this blocks CREATING new USDC intents. It does not block
// confirming or crediting one that has been paid, and intents already quoted
// stay payable for the rest of their lock. The hard stop that rejects payments
// in flight is `pause()` on the receiver contract — manual escalation, not this.
// ---------------------------------------------------------------------------

const setGate = (enabled: boolean) =>
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      UsdcPaymentsUseCases.setManualGate(user, enabled),
      `Failed to ${enabled ? 'enable' : 'disable'} USDC payments`,
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    // The composite is re-read rather than assumed: enabling the manual gate
    // does not open the path if the treasury is over its cap or the balance is
    // unknown, and an admin who clicks "enable" is owed that answer immediately
    // rather than from the next dashboard refresh.
    //
    // Caught, because the flip has ALREADY happened and already alerted by this
    // point. Letting this read escape would hand asyncSafeHandler a 500 and the
    // card would render "Change failed — the gate is unchanged" over a gate that
    // did change: the exact hazard the comment beside that message warns about,
    // inverted, on the control an incident reaches for. An admin told the
    // disable failed may escalate to `pause()` on the receiver for nothing.
    //
    // The re-read is a convenience; the flip is the result. So the answer
    // degrades to omitting `availability` and the dashboard falls back to its
    // next refresh.
    let availability: UsdcAvailability | undefined
    try {
      availability = await UsdcPaymentsUseCases.getAvailability()
    } catch (error) {
      logger.warn(
        'USDC gate flipped, but the composite could not be re-read',
        { enabled, error },
      )
    }

    res.status(200).json({
      enabled,
      changed: result.value.changed,
      availability,
    })
  })

paymentsController.post('/usdc/enable', setGate(true))
paymentsController.post('/usdc/disable', setGate(false))
