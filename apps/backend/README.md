## API Usage

You can interact with the server using the following curl commands:

### Submit Data

To submit data to the server:

```bash
curl -X POST http://localhost:3000/upload-file \
     -H "Content-Type: application/json" \
     -d '{
       "data": "Your data here",
       "dataType": "raw",
       "name": "example.txt",
       "mimeType": "text/plain"
     }'
```

This will return a JSON response with the metadata CID of the stored data:

```json
{
  "metadataCid": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
}
```

### Retrieve Data

To retrieve data from the server using its metadata CID:

```bash
curl http://localhost:3000/retrieve/1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

Replace the CID in the URL with the actual metadata CID you received when submitting the data.

This will return a JSON response with the retrieved data:

```json
{
  "data": "Your data here"
}
```

If the data is not found, you'll receive a 404 error response.

Note: Make sure the server is running (use `yarn start:server`) before executing these commands.

### Additional Information

- The server can handle both small and large data submissions.
- For large data (>64KB), the server will automatically chunk the data and store it accordingly.
- The `dataType` field in the submit request can be either "raw" or "file".
- You can include optional `name` and `mimeType` fields for better metadata management.
- Custom metadata can be included in the submit request as additional fields.
