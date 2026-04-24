/**
 * Server-side representation of an API key. The raw secret is never stored
 * — only a sha256 hash. The `prefix` is the first few characters of the
 * original secret, kept in clear for UI display so users can tell their
 * keys apart.
 */
export type ApiKey = {
  id: string
  name: string
  prefix: string
  secretHash: string
  oauthProvider: string
  oauthUserId: string
  deletedAt: Date | null
  expiresAt: Date | null
  createdAt: Date | null
}

/**
 * Safe to return to clients — never includes the secret or its hash.
 */
export type ApiKeyWithoutSecret = Omit<ApiKey, 'secretHash'> & {
  secretHash?: never
}

/**
 * Returned once, immediately after `createApiKey` or `rotateApiKey`.
 * The plaintext `secret` is only ever visible in this response;
 * there is no endpoint that can reveal it again later.
 */
export type CreatedApiKey = ApiKeyWithoutSecret & {
  secret: string
}

export type CreateApiKeyInput = {
  name: string
  /** ISO-8601 string. `null`/omitted = never expires. */
  expiresAt?: string | null
}
