// The body of a request to create a personal or an organisation API key.
export const parseCreateApiKeyBody = (
  body: unknown,
): { name: string | null; expiresAt: Date | null } | { error: string } => {
  // Allow callers to POST with no body at all — creates an unnamed,
  // never-expiring key.
  if (body === undefined || body === null) {
    return { name: null, expiresAt: null }
  }
  if (typeof body !== 'object') {
    return { error: 'Request body must be a JSON object' }
  }
  const { name, expiresAt } = body as {
    name?: unknown
    expiresAt?: unknown
  }

  let parsedName: string | null = null
  if (name !== undefined && name !== null) {
    if (typeof name !== 'string') {
      return { error: 'Attribute `name` must be a string' }
    }
    const trimmed = name.trim()
    if (trimmed.length > 64) {
      return {
        error: 'Attribute `name` must be 64 characters or fewer',
      }
    }
    parsedName = trimmed.length === 0 ? null : trimmed
  }

  let parsedExpiresAt: Date | null = null
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    if (typeof expiresAt !== 'string') {
      return { error: 'Attribute `expiresAt` must be an ISO-8601 string' }
    }
    const parsed = new Date(expiresAt)
    if (Number.isNaN(parsed.getTime())) {
      return { error: 'Attribute `expiresAt` is not a valid date' }
    }
    if (parsed.getTime() <= Date.now()) {
      return { error: 'Attribute `expiresAt` must be in the future' }
    }
    parsedExpiresAt = parsed
  }

  return { name: parsedName, expiresAt: parsedExpiresAt }
}
