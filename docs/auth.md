# Authentication Service

The auth service is a microservice responsible for user authentication, authorization, and session management. It provides multi-provider OAuth support, custom JWT authentication, API key management, and user/organization management.

## Production deployment

This service runs on AWS Lambda. To deploy a new version, follow these steps:

1. Generate lambda build with `yarn workspace auth lambda:build`, This will generate a file at `apps/auth/build/index.js`
2. Compress (in zip format) the generated file.
3. Go to AWS Lambda, select the authentication lambda, and upload the code as a ZIP

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
- Uses wallet address as both user ID and username

### 5. **API Key Authentication**

- Allows users to create API keys for programmatic access
- Keys are validated against the database
- Used for server-to-server authentication

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

- Uses Node.js 20.18.3
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

#### `POST /users/@me/accessToken`: Creates JWT session tokens

#### `POST /users/@me/refreshToken`: Refreshes access token using refresh token

#### `DELETE /users/@me/invalidateToken`: Invalidates a refresh token

#### `GET /users/@me`: Gets current user information with organization

#### `GET /users/@me/apiKeys`: Lists user's API keys (without secrets)

#### `POST /users/@me/apiKeys/create`: Creates a new API key

#### `DELETE /users/@me/apiKeys/:id`: Deletes an API key

#### `POST /users/admin/add`: Adds a user to admin role

#### `POST /users/admin/remove`: Removes admin role from a user

#### `GET /users/list`: Lists all users (paginated)

#### `GET /users/:publicId`: Gets user information by public ID

#### `POST /users/batch`: Gets multiple users by publicIds (admin only)

### Organization Endpoints

#### `GET /organizations/:organizationId`: Gets organization information with members

## Security Considerations

1. **Token Revocation**: Refresh tokens can be revoked via the token registry
2. **API Key Security**: API keys are stored securely and support soft deletion
3. **Role-Based Access**: Admin endpoints require admin role verification
4. **OAuth Validation**: All OAuth tokens are validated against provider APIs
5. **JWT Expiry**: Access tokens expire after 1 hour, refresh tokens after 7 days
