import { v5 } from "uuid";

// 16 ASCII bytes, used directly as the uuid v5 namespace.
const USER_PUBLIC_ID_NAMESPACE = new TextEncoder().encode("public-id-user-1");

/**
 * A user's publicId is a deterministic function of their OAuth identity, so it
 * can be derived anywhere the (provider, userId) pair is known — e.g. from an
 * `object_ownership` row — without a lookup against the auth service.
 */
export const deriveUserPublicId = (
  oauthProvider: string,
  oauthUserId: string,
): string => v5(`${oauthProvider}-${oauthUserId}`, USER_PUBLIC_ID_NAMESPACE);
