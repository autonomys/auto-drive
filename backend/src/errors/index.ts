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

export class ObjectNotFoundError extends Error {
  constructor(message: string) {
    super(message)
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

export const handleError = (error: Error, res: Response) => {
  if (error instanceof HttpError) {
    error.handleResponse(res)
  } else {
    new InternalError('Internal server error').handleResponse(res)
  }
}
