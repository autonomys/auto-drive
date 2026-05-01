export class APIKeyError extends Error {
  readonly httpStatus: number

  constructor(message: string, httpStatus: number) {
    super(message)
    this.name = this.constructor.name
    this.httpStatus = httpStatus
  }
}

export class APIKeyValidationError extends APIKeyError {
  constructor(message: string) {
    super(message, 400)
  }
}

export class APIKeyNotFoundError extends APIKeyError {
  constructor(message = 'API key not found') {
    super(message, 404)
  }
}

export class APIKeyExpiredError extends APIKeyError {
  constructor(message = 'API key has expired') {
    super(message, 401)
  }
}

export class APIKeyForbiddenError extends APIKeyError {
  constructor(message = 'User is not the owner of the API key') {
    super(message, 403)
  }
}
