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

/**
 * A chunk of an object could not be resolved from either `nodes` or the upload
 * blockstore.
 *
 * 503, not 404: the object's metadata exists and its chunk list is intact, so
 * this is "cannot serve right now", not "does not exist". Answering 404 would
 * tell an S3 client the key is gone and invite it to re-upload. Typed (rather
 * than a bare Error) so the download paths can turn it into a real status code
 * before the response body is committed, instead of resetting a stream that has
 * already sent 200 + headers — the failure mode issue #815 describes as
 * uninterpretable by any client.
 */
export class ChunkNotFoundError extends HttpError {
  static readonly statusCode = 503
  public readonly cid: string
  constructor(cid: string) {
    super(ChunkNotFoundError.statusCode, `Chunk not found: cid=${cid}`)
    this.name = 'ChunkNotFoundError'
    this.cid = cid
  }
}

export const handleError = (error: Error, res: Response) => {
  if (error instanceof HttpError) {
    error.handleResponse(res)
  } else {
    new InternalError('Internal server error').handleResponse(res)
  }
}
