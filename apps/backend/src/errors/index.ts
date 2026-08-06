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

// Why a USDC quote could not be produced. The price oracle draws four distinct
// causes and they mean genuinely different things to whoever is buying: two are
// our problem and retryable, two are about the requested size and are not. An
// Ethereum outage reaching the user as "your purchase is too large" would send
// them to shrink a purchase that was never the problem, so the cause travels to
// the client as a code instead of being flattened into a 500 or into prose.
export enum QuoteErrorCode {
  // We could not reach the chain, or what we read failed its sanity checks.
  ORACLE_UNAVAILABLE = 'PRICE_ORACLE_UNAVAILABLE',
  // The pool's price is currently moving in a way we will not quote against.
  PRICE_UNSTABLE = 'PRICE_UNSTABLE',
  // The pool has no liquidity to fill a conversion this large.
  QUOTE_TOO_LARGE = 'QUOTE_TOO_LARGE',
  // The amount is unquotable on its own terms — below the minimum, or out of
  // range for the quoter.
  AMOUNT_INVALID = 'QUOTE_AMOUNT_INVALID',
}

// A quote failure, carrying both the HTTP status the cause maps to and the
// machine-readable code.
//
// One class parameterised by cause rather than four subclasses: the mapping from
// oracle error to (status, code) is a small table that is far easier to review as
// a table than as four near-identical class bodies, and the response shape has to
// be identical across all four regardless.
export class QuoteFailedError extends HttpError {
  public readonly code: QuoteErrorCode

  constructor(statusCode: number, code: QuoteErrorCode, message: string) {
    super(statusCode, message)
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
