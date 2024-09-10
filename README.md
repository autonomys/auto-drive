# Autonomys Data Storage Service

This project implements a data storage service using the Autonomys Network's substrate-based blockchain. It provides functionality for storing, retrieving, and managing data chunks and metadata.

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

For more details on the architecture and data flow, refer to the design document:

```markdown:backend/design-doc.md
startLine: 141
endLine: 177
```

## Testing

Run the test suite:

```
yarn test
```
