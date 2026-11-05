export class OrganizationError extends Error {
  readonly httpStatus: number

  constructor(message: string, httpStatus: number) {
    super(message)
    this.name = this.constructor.name
    this.httpStatus = httpStatus
  }
}

export class OrganizationValidationError extends OrganizationError {
  constructor(message: string) {
    super(message, 400)
  }
}

export class OrganizationNotFoundError extends OrganizationError {
  constructor(message: string) {
    super(message, 404)
  }
}

export class OrganizationConflictError extends OrganizationError {
  constructor(message: string) {
    super(message, 409)
  }
}
