export class ApiKeyError extends Error {
  readonly httpStatus: number

  constructor(message: string, httpStatus: number) {
    super(message)
    this.name = this.constructor.name
    this.httpStatus = httpStatus
  }
}

export class ApiKeyValidationError extends ApiKeyError {
  constructor(message: string) {
    super(message, 400)
  }
}

export class ApiKeyNotFoundError extends ApiKeyError {
  constructor(message = 'API key not found') {
    super(message, 404)
  }
}

export class ApiKeyExpiredError extends ApiKeyError {
  constructor(message = 'API key has expired') {
    super(message, 401)
  }
}

export class ApiKeyForbiddenError extends ApiKeyError {
  constructor(message = 'User is not the owner of the API key') {
    super(message, 403)
  }
}
