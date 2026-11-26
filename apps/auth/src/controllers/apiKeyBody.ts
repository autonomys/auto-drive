import { ApiKeyScope } from '@auto-drive/models'

const SCOPES: string[] = Object.values(ApiKeyScope)

// The body of a request to create a personal or an organisation API key. Only
// organisation keys take scopes; without them a key has full access.
export const parseCreateApiKeyBody = (
  body: unknown,
  { organization }: { organization: boolean },
):
  | {
      name: string | null
      expiresAt: Date | null
      scopes: ApiKeyScope[] | null
    }
  | { error: string } => {
  // Allow callers to POST with no body at all — creates an unnamed,
  // never-expiring key.
  if (body === undefined || body === null) {
    return { name: null, expiresAt: null, scopes: null }
  }
  if (typeof body !== 'object') {
    return { error: 'Request body must be a JSON object' }
  }
  const { name, expiresAt, scopes } = body as {
    name?: unknown
    expiresAt?: unknown
    scopes?: unknown
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

  if (scopes !== undefined && !organization) {
    return {
      error: 'Attribute `scopes` is only available to organization API keys',
    }
  }
  if (
    scopes !== undefined &&
    scopes !== null &&
    (!Array.isArray(scopes) ||
      scopes.length === 0 ||
      scopes.some((scope) => !SCOPES.includes(scope)) ||
      new Set(scopes).size !== scopes.length)
  ) {
    return {
      error: `Attribute \`scopes\` must be a non-empty list of distinct scopes: ${SCOPES.join(', ')}`,
    }
  }

  return {
    name: parsedName,
    expiresAt: parsedExpiresAt,
    scopes: (scopes as ApiKeyScope[] | undefined) ?? null,
  }
}
