# Auto Drive: Autonomys Network's Data Access Layer

![Autonomys Banner](https://github.com/autonomys/auto-drive/blob/main/.github/images/autonomys-banner.webp)

Auto Drive is a decentralized content-addressed storage solution built on the Autonomys Network, leveraging its underlying permanent storage layer known as the Autonomys Distributed Storage Network (DSN). It provides users with a secure and efficient way to store, share, and manage digital assets with the assurance of long-term data persistence.

Auto Drive offers a user-friendly interface for uploading and downloading files, as well as an [SDK](https://github.com/autonomys/auto-sdk/tree/main/packages/auto-drive) and API for developers to integrate storage capabilities into their applications.

## Getting Started

### Prerequisites

- Node.js (v20 or later)
- Yarn

### Installation

For running auto-drive locally you need to launch infra, auth, backend and frontend

### Infrastructure

Spin up docker instances with:

```bash
docker compose -f docker-compose.dev.yml --env-file .env.dev up -d
```

Initialise the DB using:

```bash
make init-submodules
yarn
yarn backend db-migrate up
yarn auth db-migrate up
cd apps/hasura
hasura migrate apply --admin-secret myadminsecretkey
hasura metadata apply --admin-secret myadminsecretkey
cd -
```

### Auth

Once infra is spin up, auth can be launched simply with:

```bash
cd apps/auth
cp .env.sample .env
yarn build
yarn start
cd -
```

### Backend

Next step would be to launch backend using:

```bash
cd apps/backend
cp .env.sample .env
cd -
```

Then, you have to enter your have to update to your needs the `.env` file

### Frontend

Similarly for launching frontend:

```bash
cd apps/frontend
cp .env.sample .env
cd -
```

Then, you have to enter your have to update to your needs the `.env` file (e.g adding Google OAuth app)

### Running the Service

Start the server:

```
cd backend
yarn start
```

The server will start on `http://localhost:3000`.

## How to use?

If you are building with Javascript or Typescript you can use [@autonomys/auto-drive](https://www.npmjs.com/package/@autonomys/auto-drive) for other languages you should integrate with the [REST API](https://mainnet.auto-drive.autonomys.xyz/api/docs)

## Testing

Run the test suite:

```
yarn test
```
