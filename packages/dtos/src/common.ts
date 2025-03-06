export type ErrorResponse = {
  error: string
  details?: string
}

export type ApiResponse<T> = T | ErrorResponse
