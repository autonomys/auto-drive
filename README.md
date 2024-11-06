# Auto Drive: Autonomys Network's Data Access Layer

Auto Drive is a decentralized content-addressed storage solution built on the Autonomys Network, leveraging its underlying permanent storage layer known as the Autonomys Distributed Storage Network (DSN). It provides users with a secure and efficient way to store, share, and manage digital assets with the assurance of long-term data persistence. 

Auto Drive offers a user-friendly interface for uploading and downloading files, as well as an [SDK](https://github.com/autonomys/auto-sdk/tree/main/packages/auto-drive) and API for developers to integrate storage capabilities into their applications.

## Features

- Data chunking and reassembly
- Metadata management
- Blockchain integration for data storage
- Transaction management
- RESTful API for data operations

## Getting Started

### Prerequisites

- Node.js (v14 or later)
- Yarn
- Access to an Autonomys Network node

### Installation

1. Clone the repository:

   ```
   git clone https://github.com/your-username/autonomys-data-storage.git
   cd autonomys-data-storage
   ```

2. Install dependencies:

   ```
   yarn install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add the following:
   ```
   RPC_ENDPOINT=ws://localhost:9944
   KEYPAIR_URI=//Alice
   ```
   Adjust the values as needed for your Autonomys Network setup.

### Running the Service

Start the server:

```
cd backend
yarn start
```

The server will start on `http://localhost:3000`.

## API Endpoints

- `POST /upload-file`: Submit data for storage
- `GET /retrieve/:cid`: Retrieve data by CID
- `GET /metadata/:cid`: Get metadata for a specific CID
- `GET /all`: Get all stored data (limited to 500 characters per entry)
- `GET /transaction/:cid`: Get transaction result for a specific CID
- `GET /transactions`: Get all transaction results
- `GET /fromTransactions/:cid`: Retrieve data directly from blockchain transactions

## Architecture

The service is built with the following components:

1. Storage Manager: Handles data chunking, reassembly, and metadata management
2. Transaction Manager: Manages blockchain transactions for data storage
3. API Layer: Provides RESTful endpoints for interacting with the service

## Testing

Run the test suite:

```
yarn test
```
