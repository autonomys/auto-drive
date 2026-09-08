import { Response } from 'express'

export abstract class HttpError extends Error {
  public readonly statusCode: number
  public readonly statusText: string
  public readonly message: string

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
    this.statusText = message
    this.message = message
  }

  handleResponse(res: Response) {
    res.status(this.statusCode).json({
      error: this.message,
    })
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

/**
 * A Range the object cannot satisfy → 416. Carries the object's real size so the
 * caller can answer with the `Content-Range: bytes * /<size>` S3 requires, which
 * is how a client learns what range it should have asked for.
 */
export class RangeNotSatisfiableError extends HttpError {
  static readonly statusCode = 416
  constructor(
    message: string,
    public readonly objectSize: bigint,
  ) {
    super(RangeNotSatisfiableError.statusCode, message)
    this.name = 'RangeNotSatisfiableError'
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
  constructor(message: string) {
    super(ForbiddenError.statusCode, message)
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
    super(message)
    this.name = 'CreditCapExceededError'
  }

  // Mirrors the { error: <code>, message: <human-readable> } shape the intents
  // controller already uses for GOOGLE_ACCOUNT_REQUIRED, so a client can branch
  // on `error` and surface `message` verbatim. Overriding here rather than
  // special-casing in the controller means no call site can forget the code.
  override handleResponse(res: Response) {
    res.status(this.statusCode).json({
      error: CreditCapExceededError.code,
      message: this.message,
    })
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
    super(message)
    this.name = 'UsdcPaymentsDisabledError'
  }

  override handleResponse(res: Response) {
    res.status(this.statusCode).json({
      error: UsdcPaymentsDisabledError.code,
      message: this.message,
    })
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
  constructor(message: string) {
    super(ServiceUnavailableError.statusCode, message)
    this.name = 'ServiceUnavailableError'
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
    super(message)
    this.name = 'QuoteFailedError'
    this.code = code
  }

  // Mirrors the { error: <code>, message: <human-readable> } shape the intents
  // controller already uses for GOOGLE_ACCOUNT_REQUIRED and CREDIT_CAP_EXCEEDED,
  // so a client branches on `error` and can surface `message` verbatim.
  override handleResponse(res: Response) {
    res.status(this.statusCode).json({
      error: this.code,
      message: this.message,
    })
  }
}

export const handleError = (error: Error, res: Response) => {
  if (error instanceof HttpError) {
    error.handleResponse(res)
  } else {
    new InternalError('Internal server error').handleResponse(res)
  }
}
