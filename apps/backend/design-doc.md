# Data Stack Architecture - WIP

# Data Access Gateway

## Overview

The Data Access Gateway serves as the entry point for external interactions with the Autonomys Network's data access layer PoC. It provides a basic interface for uploading and retrieving data stored on the network's Distributed Storage Network (DSN).

## Objectives

- Demonstrate basic data upload and retrieval functionality
- Provide a simple, secure entry point for data operations
- Route requests to appropriate internal services

## Architecture

### **Core** Components

1. Request Handler
2. Basic Authentication Module (optional for PoC)
3. Request Router

## Component Details

### 1. Request Handler

- Accepts incoming HTTP requests
- Performs basic request validation

### 2. Basic Authentication Module

- Verifies user credentials using a simple API key mechanism

### 3. Request Router

- Routes requests to the appropriate internal service (Upload or Retrieval)

## Key Processes

### Data Upload Process

1. Receive upload request
2. Authenticate user (API key)
3. Basic validation (file size, format)
4. Route to Data Upload Service
5. Return upload status to client
   1. Track status of upload through process
      1. Metadata and file chunking info
      2. Upload transactions
      3. Data archived

### Data Retrieval Process

1. Receive retrieval request
2. Route to Data Retrieval Service
3. Return data to client

## Future Considerations

- Caching
- Load balancing

# Data Chunking and Metadata Manager Service

## Overview

This service handles the chunking of large data sets and manages associated metadata. It generates CIDs for the primary data only, simplifying data management and blockchain interactions.

## Core Components

1. Data Chunker
2. CID Generator
3. Metadata Manager
4. Chunk Tracker
5. Data Reassembler

## Component Details

### 1. Data Chunker

- Breaks data larger than 1 MB into smaller chunks
- Ensures each chunk is within the block size limit

### 2. CID Generator

- Generates a CID for the entire data set based on its content
- Generates CIDs for individual chunks

### 3. Metadata Manager

- Creates and manages metadata for each data set, including:
  - Data CID
  - Total size
  - Number of chunks
  - List of chunk CIDs and their order
  - Custom metadata (if any)

### 4. Chunk Tracker

- Maintains a record of all chunks for each data set
- Tracks the storage location of each chunk in the DSN

### 5. Data Reassembler

- Retrieves chunks based on metadata
- Reassembles the data in the correct order

## Data Structures

### Data Metadata

```json
{
  "dataCid": "content_identifier_of_entire_dataset",
  "dataType": "file", // or "raw"
  "name": "example.pdf", // optional, for files
  "mimeType": "application/pdf",
  "totalSize": 15000000,
  "totalChunks": 4,
  "chunks": [
    {
      "cid": "content_identifier_of_chunk_1",
      "order": 1,
      "size": 4000000,
      "dsnLocation": {
        "pieceIndex": 1,
        "offset": 20
      }
    }
    // ... other chunks ...
  ],
  "customMetadata": {
    // Any additional user-defined metadata
  }
}
```

## Key Processes

### Data Upload Process

1. Receive data from Data Upload Service
2. If data > 1MB, chunk the data
3. Generate CID for the entire data set
4. Generate CIDs for each chunk
5. Create metadata
6. Pass chunks and their CIDs to Blockchain Transaction Manager for storage
7. Store metadata off-chain
8. Return data CID to Data Upload Service

### Data Retrieval Process

1. Receive data retrieval request (CID) from Data Retrieval Service
2. Fetch metadata using the CID
3. Request chunks from Blockchain Transaction Manager
4. Reassemble data from chunks
5. Verify reassembled data integrity using the original CID
6. Return complete data set to Data Retrieval Service

## Interfaces

### With Blockchain Transaction Manager

- Send: Chunks and their CIDs for storage
- Receive: Confirmation of chunk storage

### With Off-Chain Storage (for metadata)

- Store and retrieve metadata using data CID as key

# Transaction Manager Design and Implementation Plan

## Overview

The Transaction Manager is responsible for submitting data chunks to the Autonomys Network's substrate-based blockchain. It will use transaction batching to optimize the submission process and improve efficiency.

## Objectives

- Efficiently submit data chunks to the blockchain
- Utilize transaction batching for improved performance
- Handle potential failures and retries
- Provide status updates on transaction submissions

## Architecture

### Core Components

1. Transaction Queue
2. Batch Builder
3. Submission Handler
4. Status Tracker
5. Retry Mechanism

## Component Details

### 1. Transaction Queue

- Maintains a queue of pending chunk submissions
- Prioritizes transactions based on predefined criteria (e.g., time of submission, size)

### 2. Batch Builder

- Constructs batches of transactions from the queue
- Ensures batches are within size and weight limits of the blockchain

### 3. Submission Handler

- Interfaces with the Autonomys Network's blockchain API
- Submits batched transactions to the blockchain

### 4. Status Tracker

- Monitors the status of submitted transactions
- Updates the status of individual chunks and overall data uploads

### 5. Retry Mechanism

- Handles failed submissions
- Implements exponential backoff for retries

## Key Processes

### Chunk Submission Process

1. Receive chunk data from Data Chunking and Metadata Manager Service
2. Add chunk to Transaction Queue
3. Batch Builder creates transaction batches
4. Submission Handler sends batches to blockchain
5. Status Tracker monitors submission status
6. Update overall upload status
7. If submission fails, Retry Mechanism handles resubmission

## Implementation Plan

### Phase 1: Basic Functionality

1. Implement Transaction Queue
2. Create basic Batch Builder
3. Develop simple Submission Handler
4. Implement basic Status Tracker

### Phase 2: Enhanced Features

1. Improve Batch Builder with optimized batching strategies
2. Enhance Submission Handler with better error handling
3. Implement Retry Mechanism with exponential backoff
4. Expand Status Tracker capabilities

### Phase 3: Optimization and Scaling

1. Implement priority queue for Transaction Queue
2. Optimize batch size and frequency based on network conditions
3. Add support for concurrent batch submissions
4. Implement more sophisticated status reporting

## Error Handling

- Implement robust error handling for network issues, blockchain errors, and unexpected failures
- Log errors with appropriate context for debugging
- Provide clear error messages to the calling service
