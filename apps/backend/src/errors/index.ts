import { Response } from 'express'

export abstract class HttpError extends Error {
  public readonly statusCode: number
  public readonly statusText: string
  public readonly message: string
  /**
   * A machine-readable code, for the errors a client has to BRANCH on rather
   * than merely render — a closed USDC path offers AI3, a credit cap offers a
   * smaller purchase, and neither decision should depend on the wording of a
   * sentence written for a human.
   *
   * Set it and the body becomes `{ error: <code>, message }`; leave it and the
   * body stays `{ error: <the message> }`, which is what every uncoded error has
   * always sent. Held on the base class rather than duplicated as an identical
   * `handleResponse` override per subclass, which is what four of these had
   * grown into — and which meant the SHAPE, the thing clients actually parse,
   * was re-declared every time instead of being decided once.
   */
  protected readonly errorCode?: string

  constructor(statusCode: number, message: string, errorCode?: string) {
    super(message)
    this.statusCode = statusCode
    this.statusText = message
    this.message = message
    this.errorCode = errorCode
  }

  handleResponse(res: Response) {
    res
      .status(this.statusCode)
      .json(
        this.errorCode
          ? { error: this.errorCode, message: this.message }
          : { error: this.message },
      )
  }
}

// Must extend HttpError (not Error) so handleError maps it to 404, not 500.
export class ObjectNotFoundError extends HttpError {
  static readonly statusCode = 404
  constructor(message: string) {
    super(ObjectNotFoundError.statusCode, message)
    this.name = 'ObjectNotFoundError'
  }
}

export class InternalError extends HttpError {
  static readonly statusCode = 500
  constructor(message: string) {
    super(InternalError.statusCode, message)
    this.name = 'InternalError'
  }
}

export class ObjectTooLargeError extends HttpError {
  static readonly statusCode = 413
  constructor(message: string) {
    super(ObjectTooLargeError.statusCode, message)
    this.name = 'ObjectTooLargeError'
  }
}

export class IllegalContentError extends HttpError {
  static readonly statusCode = 451
  constructor(message: string) {
    super(IllegalContentError.statusCode, message)
    this.name = 'Unavailable For Legal Reasons'
  }
}

export class NotAcceptableError extends HttpError {
  static readonly statusCode = 406
  constructor(message: string) {
    super(NotAcceptableError.statusCode, message)
    this.name = 'NotAcceptableError'
  }
}

export class PaymentRequiredError extends HttpError {
  static readonly statusCode = 402
  constructor(message: string) {
    super(PaymentRequiredError.statusCode, message)
    this.name = 'PaymentRequiredError'
  }
}

export class ForbiddenError extends HttpError {
  static readonly statusCode = 403
  // `errorCode` forwarded, not swallowed: the coded 403s below are subclasses of
  // this one, and it is the only place they can reach HttpError from.
  constructor(message: string, errorCode?: string) {
    super(ForbiddenError.statusCode, message, errorCode)
    this.name = 'ForbiddenError'
  }
}

// 403 Forbidden — the requested purchase would push the account past its
// per-user credit cap.
//
// A subclass rather than a bare ForbiddenError for two reasons: callers can tell
// "no credit headroom" apart from every other 403 without string-matching a
// message, and the machine-readable code travels with the error instead of
// having to be re-attached at each call site that might raise it.
export class CreditCapExceededError extends ForbiddenError {
  static readonly code = 'CREDIT_CAP_EXCEEDED'
  constructor(message: string) {
    super(message, CreditCapExceededError.code)
    this.name = 'CreditCapExceededError'
  }
}

export class NotFoundError extends HttpError {
  static readonly statusCode = 404
  constructor(message: string) {
    super(NotFoundError.statusCode, message)
    this.name = 'NotFoundError'
  }
}

export class BadRequestError extends HttpError {
  static readonly statusCode = 400
  constructor(message: string) {
    super(BadRequestError.statusCode, message)
    this.name = 'BadRequestError'
  }
}

// 409 Conflict — request is valid but the resource is in the wrong state for
// the operation (e.g. trying to reprocess an intent that is not OVER_CAP).
export class ConflictError extends HttpError {
  static readonly statusCode = 409
  constructor(message: string) {
    super(ConflictError.statusCode, message)
    this.name = 'ConflictError'
  }
}

// 410 Gone — resource existed but is no longer available (e.g. expired intent).
export class GoneError extends HttpError {
  static readonly statusCode = 410
  constructor(message: string) {
    super(GoneError.statusCode, message)
    this.name = 'GoneError'
  }
}

// 403 Forbidden — paying in USDC is not open to this caller.
//
// A subclass rather than a bare ForbiddenError for the same reason as
// CreditCapExceededError: a client has to be able to tell "this asset is not
// available to you" apart from "you need a Google account" without matching on
// prose, and the code travels with the error rather than being re-attached at
// each call site.
export class UsdcPaymentsDisabledError extends ForbiddenError {
  static readonly code = 'USDC_PAYMENTS_DISABLED'
  constructor(message: string) {
    super(message, UsdcPaymentsDisabledError.code)
    this.name = 'UsdcPaymentsDisabledError'
  }
}

// 503 Service Unavailable — a dependency we need was unreachable, or the data it
// returned was not trustworthy enough to act on.
//
// Deliberately not 500: nothing is wrong with the request, the condition is
// usually transient, and a client should be told to retry rather than to change
// what it asked for.
export class ServiceUnavailableError extends HttpError {
  static readonly statusCode = 503
  // See ForbiddenError: the coded 503s below reach HttpError through here.
  constructor(message: string, errorCode?: string) {
    super(ServiceUnavailableError.statusCode, message, errorCode)
    this.name = 'ServiceUnavailableError'
  }
}

// 503 Service Unavailable — paying in USDC is temporarily closed.
//
// A distinct class from UsdcPaymentsDisabledError (403), and the status is the
// whole point. That one says "not for you, on this deployment", so a client
// should stop offering the option. This one says "not right now": an admin
// reopens the switch, a manual conversion brings the treasury back under its
// cap, the oracle recovers — so a client should offer AI3 and try again later.
//
// A subclass rather than a bare ServiceUnavailableError for one concrete reason:
// the base class serialises as `{ error: <the message> }` with no `message` key,
// and the frontend deliberately reads ONLY `message` on a 5xx, because a plain
// 5xx body there is a raw exception string rather than a sentence for a buyer
// (see createIntent in apps/frontend/src/services/api.ts). So a bare 503 arrives
// as "Network response was not ok: Service Unavailable" — precisely the generic
// failure this refusal exists to replace.
//
// The message is deliberately generic, unlike the one logged beside it. Which
// gate closed — the treasury holding 2,014 USDC against a 2,000 cap, the
// oracle's window gone thin — is an operational fact that belongs in the log and
// on the admin dashboard, both of which already carry it. A buyer's only useful
// next step is AI3 or later, and neither changes with the reason.
export class UsdcUnavailableError extends ServiceUnavailableError {
  static readonly code = 'USDC_PAYMENTS_UNAVAILABLE'

  constructor(
    message = 'Paying in USDC is temporarily unavailable. Pay in AI3 instead, ' +
      'or try again later.',
  ) {
    super(message, UsdcUnavailableError.code)
    this.name = 'UsdcUnavailableError'
  }
}

// Why a USDC quote could not be produced.
//
// The oracle refuses for a dozen distinct reasons (see OracleUnavailableReason)
// and they collapse into two facts a buyer can act on: the market has re-priced
// past the window the average is built from, or we could not obtain a rate we
// trust. Both are our problem and both are retryable, so both are 503s — the
// cause still travels as a code, because "the market moved" and "the source is
// down" call for different words on a screen and different alerts behind it.
//
// There is deliberately no code here for "ask for less". The rate is one
// size-independent average of realized fills, so no oracle failure is about the
// requested size, and a code the mapping cannot produce is a promise to clients
// we would not keep.
export enum QuoteErrorCode {
  // We could not read a trustworthy rate, or what we read failed its guards.
  ORACLE_UNAVAILABLE = 'PRICE_ORACLE_UNAVAILABLE',
  // The market has re-priced past the window the average is built from, so the
  // rate describes a regime that has already been left.
  PRICE_UNSTABLE = 'PRICE_UNSTABLE',
}

// A quote failure, carrying the machine-readable cause.
//
// Extends ServiceUnavailableError rather than taking a status: every quote
// failure is a 503, so the status belongs in the type rather than at each
// construction site where it could be passed inconsistently.
//
// One class parameterised by cause rather than one subclass per code: the
// mapping from oracle reason to code is a small table, far easier to review as a
// table than as near-identical class bodies, and the response shape is identical
// across all of them regardless.
export class QuoteFailedError extends ServiceUnavailableError {
  public readonly code: QuoteErrorCode

  constructor(code: QuoteErrorCode, message: string) {
    super(message, code)
    this.name = 'QuoteFailedError'
    this.code = code
  }
}

export const handleError = (error: Error, res: Response) => {
  if (error instanceof HttpError) {
    error.handleResponse(res)
  } else {
    new InternalError('Internal server error').handleResponse(res)
  }
}
