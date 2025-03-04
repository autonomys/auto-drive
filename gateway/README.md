# Multi-Network

A unified gateway solution designed to seamlessly connect and manage multiple networks through a single, streamlined interface.

## API Endpoints

### Retrieve File by CID

**Endpoint:** `GET /file/:cid`

Retrieves a file based on its Content Identifier (CID). If the CID corresponds to a folder, the request is redirected to the folder endpoint.

**Responses:**

- `302 Redirect`: Redirects to `/folder/:cid` if the CID corresponds to a folder.
- `404 Not Found`: If no file or folder is found for the provided CID.
- `200 OK`: Successfully retrieves and serves the requested file.

### Retrieve Folder by CID

**Endpoint:** `GET /folder/:cid`

Retrieves a folder based on its Content Identifier (CID). If the CID corresponds to a file, the request is redirected to the file endpoint.

**Responses:**

- `302 Redirect`: Redirects to `/file/:cid` if the CID corresponds to a file.
- `404 Not Found`: If no folder or file is found for the provided CID.
- `200 OK`: Successfully retrieves and serves the requested folder.
