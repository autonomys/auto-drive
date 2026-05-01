/**
 * Server-side representation of an API key. The `secret` is stored in
 * plaintext — see the auth migration for the (deliberate) tradeoff.
 *
 * `ApiKey` intentionally carries the raw secret so internal call sites
 * (auth verification, the create-key response) don't need a second type.
 * UI clients should always receive `ApiKeyWithoutSecret` instead.
 */
export type ApiKey = {
  id: string
  name: string | null
  secret: string
  oauthProvider: string
  oauthUserId: string
  deletedAt: Date | null
  expiresAt: Date | null
  createdAt: Date | null
}

/**
 * Safe shape for list responses. The secret is stripped; a masked
 * representation (first 3 + last 3 chars with bullets in between)
 * is exposed so users can visually tell their keys apart.
 */
export type ApiKeyWithoutSecret = Omit<ApiKey, 'secret'> & {
  maskedSecret: string
  secret?: never
}

export type CreateApiKeyInput = {
  /** Optional human-readable label. Omitted/null = nameless. */
  name?: string | null
  /** ISO-8601 string. `null`/omitted = never expires. */
  expiresAt?: string | null
}
