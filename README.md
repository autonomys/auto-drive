# Auto Drive: Autonomys Network's Data Access Layer

![Autonomys Banner](https://github.com/autonomys/auto-drive/blob/main/.github/images/autonomys-banner.webp)

Auto Drive is a decentralized content-addressed storage solution built on the Autonomys Network, leveraging its underlying permanent storage layer known as the Autonomys Distributed Storage Network (DSN). It provides users with a secure and efficient way to store, share, and manage digital assets with the assurance of long-term data persistence.

Auto Drive offers a user-friendly interface for uploading and downloading files, as well as an [SDK](https://github.com/autonomys/auto-sdk/tree/main/packages/auto-drive) and API for developers to integrate storage capabilities into their applications.

## Getting Started

### Prerequisites

- Node.js (v20 or later)
- Yarn

### Installation

1. Clone the repository:

   ```
   git clone https://github.com/autonomys/auto-drive
   cd auto-drive
   ```

2. Install dependencies:

   ```
   yarn install
   ```

3. Build services:

   ```
   yarn build
   ```

4. Launch backend (requires docker):

   ```
   docker compose up --env-file .env.dev -f docker-compose.dev.yml up -d
   ```

5. Apply hasura metadata

   ```
   yarn hasura metadata apply --admin-secret myadminsecretkey
   ```

6. Launch frontend

   ```
   yarn frontend dev
   ```

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
