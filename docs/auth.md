# Authentication Service

The auth service is a microservice responsible for user authentication, authorization, and session management. It provides multi-provider OAuth support, custom JWT authentication, API key management, and user/organization management.

## Production deployment

This service runs on AWS Lambda (`auto-drive-auth-v2`, `us-east-2`, `nodejs24.x`). Infrastructure is managed by Terraform in the `infra` repo under `resources/terraform/auto-drive-production/auth.tf`. Code deployments are done separately from infrastructure changes.

### Deploying a new code version

```bash
# 1. Build the Lambda bundle
yarn workspace auth lambda:build
# Output: apps/auth/build/index.js

# 2. Package it
zip -j apps/auth/build/index.zip apps/auth/build/index.js

# 3. Deploy to AWS
aws lambda update-function-code \
  --function-name auto-drive-auth-v2 \
  --zip-file fileb://apps/auth/build/index.zip \
  --region us-east-2
```

### Infrastructure changes

Lambda configuration (runtime, memory, env vars, IAM, API Gateway) is managed in Terraform. See `resources/terraform/auto-drive-production/auth.tf` in the `infra` repo.

> **Cutover note:** During the v1→v2 migration, the old `auto-drive-auth` Lambda continues to serve traffic. Once v2 is validated in production, update `AUTH_SERVICE_URL` in the backend and frontend configs to point to the new API Gateway URL (available as the `auth_api_gateway_url` Terraform output), then decommission the old Lambda and its us-east-1 API Gateway.

### Authentication Providers

The service supports multiple authentication providers:

### 1. **Google OAuth**

- Uses Google OAuth2 API
- Validates access tokens via `https://www.googleapis.com/oauth2/v1/userinfo`
- Extracts user email as username and profile picture as avatar

### 2. **Discord OAuth**

- Uses Discord API
- Validates access tokens via `https://discord.com/api/users/@me`
- Fetches username and avatar from Discord profile

### 3. **GitHub OAuth**

- Uses GitHub API
- Validates access tokens via `https://api.github.com/user`
- Uses GitHub login as username and avatar URL from profile

### 4. **Web3 Wallet (SIWE)**

- Ethereum wallet authentication using Sign-In with Ethereum
- Validates signed messages using the `siwe` library
- Messages carry a one-time nonce from `POST /users/web3/nonce` and must be issued for an origin in `WEB3_AUTH_ALLOWED_ORIGINS`
- Uses wallet address as both user ID and username

### 5. **API Key Authentication**

- Allows users to create API keys for programmatic access
- Keys are validated against the database
- Used for server-to-server authentication
- Organization keys can be limited to scopes (`files`, `end_users`, `usage`), stored in `users.api_keys.scopes` as a sorted, comma-separated list. NULL means full access, which every personal key and every key from before scopes has. The backend enforces them: see [API key scopes](#api-key-scopes)

### 6. **Custom JWT**

- Internal JWT authentication system
- Used for authenticated sessions after OAuth login
- Supports access tokens (1 hour expiry) and refresh tokens (7 days expiry)
- Includes Hasura-compatible claims for GraphQL authorization

## Configuration

Environment variables:

- `AUTH_PORT`: Server port (default: 3000)
- `LOG_LEVEL`: Logging level (default: info)
- `DATABASE_URL`: PostgreSQL connection string
- `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed origins
- `JWT_SECRET`: Base64-encoded JWT secret
- `JWT_SECRET_ALGORITHM`: JWT algorithm (default: RS256)
- `API_SECRET`: Secret for admin API authentication
- `REVOKE_TOKEN_EMITTED_BEFORE_IN_SECONDS`: Tokens issued before this time are revoked (0 = disabled)
- `WEB3_AUTH_ALLOWED_ORIGINS`: Comma-separated frontend origins that wallet sign-in messages may be issued for (default: `https://explorer.ai3.storage`)

## Hasura Integration

The custom JWT tokens include Hasura-compatible claims in the `https://hasura.io/jwt/claims` field:

```json
{
  "x-hasura-default-role": "user" | "app-admin",
  "x-hasura-allowed-roles": ["user"] | ["app-admin", "user"],
  "x-hasura-oauth-provider": "google",
  "x-hasura-oauth-user-id": "123456789",
  "x-hasura-organization-id": "org-uuid" | "none",
  "x-hasura-public-id": "user-uuid" | "none"
}
```

These claims are used by Hasura for row-level security and role-based access control.

## Public ID Generation

User public IDs are generated using UUID v5 with a deterministic namespace:

```typescript
const input = `${oauthProvider}-${oauthUserId}`;
const publicId = v5(input, Buffer.from('public-id-user-1'));
```

This ensures the same OAuth user always gets the same public ID across service restarts.

## Docker Deployment

The service includes a Dockerfile that:

- Uses Node.js 24
- Installs build dependencies
- Exposes port 3030
- Includes health check endpoint

## Testing

The service includes Jest-based tests in the `__tests__` directory:

- Admin operations tests
- API key tests
- JWT tests
- User tests
- Integration tests with testcontainers

## Development

### Start development server:

```bash
yarn workspace auth dev
```

### Run migrations:

```bash
yarn workspace auth migrate up # Note: The command `migrate` is db-migrate with the migrations table set to auth_migrations
```

### Run tests:

```bash
yarn workspace auth test
```

### Build for production:

```bash
yarn workspace auth build
```

### Build Lambda function:

```bash
yarn workspace auth lambda:build
```

## API Endpoints

### User Endpoints

#### `POST /users/@me/onboard`: Onboards a new user (marks as onboarded and creates organization)

#### `POST /users/@me/accessToken`: Creates JWT session tokens for a signed-in user. Answers 403 for any API key, personal or organization

#### `POST /users/@me/refreshToken`: Refreshes access token using refresh token

#### `DELETE /users/@me/invalidateToken`: Invalidates a refresh token

#### `GET /users/@me`: Gets current user information with organization. With an API key, also the key's `apiKeyId` and `apiKeyScopes` (null for full access)

#### `GET /users/@me/apiKeys`: Lists user's API keys (without secrets)

#### `POST /users/@me/apiKeys/create`: Creates a new API key (`{ name?, expiresAt? }`). Personal keys have full access: a `scopes` attribute is refused with 400

#### `DELETE /users/@me/apiKeys/:id`: Deletes an API key

#### `POST /users/admin/add`: Adds a user to admin role

#### `POST /users/admin/remove`: Removes admin role from a user

#### `GET /users/list`: Lists all users (paginated)

#### `GET /users/:publicId`: Gets user information by public ID

#### `POST /users/batch`: Gets multiple users by publicIds (admin only)

### Organization Endpoints

#### `GET /organizations/:organizationId`: Gets organization information: `members` (public IDs) and `memberships` (public IDs with roles). Both leave out the organization's service user and its partner end users

The endpoints below accept only the backend's service secret (`API_SECRET`), never a user token. Membership changes have preconditions on backend data (purchased credits, unresolved payments), so Auto Drive admins make them through the backend's `/organizations` endpoints. Each membership write takes the public ID of whoever made it as `actor` (the Auto Drive admin, or for partner end users the organization admin or the organization's service user) and is recorded in `users.organization_membership_changes`.

#### `POST /organizations`: Creates an organization (`{ name }`) and its service user, the user that owns the organization's API keys

#### `POST /organizations/batch`: Gets organizations by ID with their member count (not counting the service user or partner end users) and archive date (`{ ids }`, up to 100)

#### `GET /organizations/:organizationId/membership-changes`: Lists moves into, out of and within an organization

#### `POST /organizations/:organizationId/members`: Moves a user into an organization (`{ publicId, role, actor }`, `role` is `admin` or `member`). The user leaves their current organization, which is archived if no members remain. 409 for a partner end user, removed or not

#### `PUT /organizations/:organizationId/members/:publicId`: Changes a member's role (`{ role, actor }`, `role` is `admin` or `member`). 409 for a partner end user, removed or not

#### `DELETE /organizations/:organizationId/members/:publicId`: Removes a member (`{ actor }`) and restores the organization they were moved in from, or creates a new personal one. 409 for a partner end user, removed or not, who is removed through the end user endpoint

An organization's API keys belong to its service user, so they keep working whoever leaves the organization. The backend decides who may manage them, and these endpoints take no `actor`.

#### `GET /organizations/:organizationId/apiKeys`: Lists the organization's API keys (without secrets), each with its `scopes` (null for full access)

#### `POST /organizations/:organizationId/apiKeys`: Creates an API key (`{ name?, expiresAt?, scopes? }`) and returns it with its secret. `scopes` is a non-empty list of distinct scopes out of `files`, `end_users` and `usage`; omitted or null gives full access. An organization created before service users gets its service user here. 400 for invalid scopes, 404 for an unknown organization, 409 for an archived one

#### `DELETE /organizations/:organizationId/apiKeys/:apiKeyId`: Revokes one of the organization's API keys. 404 for any other key

### End users

Partner end users are a partner organization's customers, who never use Auto Drive themselves. Each is a wallet user (`web3-wallet`, stored under the EIP-55 checksummed address, as wallet sign-in finds it) with role `partner_end_user` in the partner's organization. Only enrollment gives that role: `admin` and `member` are the only roles the member endpoints accept, and they refuse to move an end user, change their role or remove them, whether the end user is removed or not. End users own the files they upload and are charged to the organization's account, but are not listed as members or counted in member counts.

The auth service owns them. What the partner gives for each one is kept on their membership row in `users.users_organizations`: `customer_reference` (the partner's own reference, unique within the organization), `upload_quota_bytes` (NULL for the account's default) and `end_user_removed_at`. All three are NULL for everyone else. Each enrollment and removal is one transaction in the auth database, so retries are safe. The backend decides who may manage end users (`/organizations/:organizationId/end-users`), checks what the partner sends and passes its cap, `PARTNER_MAX_END_USERS`.

A removed end user stays in the organization with role `partner_end_user` and `end_user_removed_at` set: they keep read-only access to their files and no longer count towards the cap. Enrolling them again clears it. They keep their customer reference while removed, so it is never given to another person.

The membership history (`users.organization_membership_changes`) records each enrollment and re-enrollment as a move into the organization (`from_organization_id` NULL) and each removal as a move out of it (`to_organization_id` NULL), both with role `partner_end_user`. An end user never leaves the organization, so for them a move out is a removal.

#### `POST /organizations/:organizationId/end-users`: Enrolls end users (`{ endUsers, maxEndUsers, actor }`) in one transaction, all or none. `endUsers` is a list of 1 to 100 `{ address, customerReference, uploadQuotaBytes }` (`uploadQuotaBytes` a positive integer or null), and `maxEndUsers` the most end users the organization may have that are not removed. Returns `[{ address, publicId, customerReference, uploadQuotaBytes, createdAt, removedAt }]` in request order, each address checksummed

- A new address gets a user, created onboarded, in this organization only.
- An end user of this organization with the same customer reference is returned unchanged, even if the request gives another quota, so a retry is safe. With another customer reference: 409.
- A removed end user of this organization is enrolled again with the customer reference and quota of the request.
- Any other user of the address (a member, a user of another organization, an end user of another organization, a wallet user who signed up): 409.
- A customer reference that another end user of this organization has, removed or not: 409.
- More than `maxEndUsers` end users that are not removed, counted in the transaction: 409.
- 400 for an invalid or repeated address (mixed case must be a valid checksum) or a repeated customer reference, 404 for an unknown organization, 409 for an archived one.

#### `GET /organizations/:organizationId/end-users`: Lists the organization's end users a page at a time (`?limit=1..500&offset=0..`, 100 and 0 by default), removed ones included, ordered by first enrollment. Returns `{ endUsers: [{ address, publicId, customerReference, uploadQuotaBytes, createdAt, removedAt }], totalCount }`, where `createdAt` is when the membership row was created and `totalCount` counts removed end users too. 404 for an unknown organization

#### `DELETE /organizations/:organizationId/end-users/:address`: Removes an end user (`{ actor }`) by setting `end_user_removed_at`. They stay in the organization and keep their files. Answers 204, also when they were already removed, which changes nothing. 400 for an invalid address, 404 if the address is not an end user of this organization

Production applies the migration to Aurora DSQL as these statements, in this order, each in its own transaction:

```sql
ALTER TABLE users.users_organizations DROP CONSTRAINT users_organizations_role_check;
ALTER TABLE users.users_organizations ADD CONSTRAINT users_organizations_role_check CHECK (role IN ('admin', 'member', 'partner_end_user')) NOT VALID;
ALTER TABLE users.users_organizations ADD COLUMN customer_reference text;
ALTER TABLE users.users_organizations ADD COLUMN upload_quota_bytes bigint;
ALTER TABLE users.users_organizations ADD COLUMN end_user_removed_at timestamp;
CREATE UNIQUE INDEX ASYNC users_organizations_customer_reference_key ON users.users_organizations (organization_id, customer_reference);
```

The last statement returns a job ID: wait for the job to finish before deploying. Deploy auth before the backend's end user routes are used.

### API key scopes

An organization key with scopes can be used only on the backend routes that declare one of its scopes. Every other route that needs authentication answers it with 403, so a route without a declared scope is closed to it. Sessions and keys with full access are not affected. Public routes stay public: there, a key that may not be used counts as no credential.

| Scope | Backend routes |
| --- | --- |
| `files` | `/uploads`, `/objects`, `/downloads` and `/s3` (S3 answers 403 `AccessDenied`) |
| `usage` | `GET /accounts/@me`, `GET /accounts/:accountId/usage-report` and `GET /accounts/:accountId/usage-report/interactions` |
| `end_users` | `POST`, `GET` and `DELETE` under `/organizations/:organizationId/end-users` |

The backend's organization API key routes refuse every API key, scoped or not.

Production applies the column to Aurora DSQL as one statement:

```sql
ALTER TABLE users.api_keys ADD COLUMN scopes text;
```

Deploy auth before the backend: an auth service from before scopes ignores `scopes` and would create a key with full access.

## Security Considerations

1. **Token Revocation**: Refresh tokens can be revoked via the token registry
2. **API Key Security**: API keys are stored securely and support soft deletion
3. **Role-Based Access**: Admin endpoints require admin role verification
4. **OAuth Validation**: All OAuth tokens are validated against provider APIs
5. **JWT Expiry**: Access tokens expire after 1 hour, refresh tokens after 7 days
