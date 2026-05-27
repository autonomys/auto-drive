# Troubleshooting

Common errors and solutions when using rclone with Auto Drive.

## Recommended Flags

| Flag | Purpose | When to use |
|---|---|---|
| `--immutable` | Prevent overwrite attempts on existing files | Every upload command |
| `-v` / `--verbose` | Show detailed transfer information | Debugging any issue |
| `--log-file=FILE` | Write detailed logs to a file | Diagnosing intermittent failures |
| `--ignore-checksum` | Skip MD5 checksum verification | Legacy objects without MD5 ETags |
| `--size-only` | Use file size instead of checksum for change detection | Alternative to `--ignore-checksum` for legacy objects |

---

## Error Reference

### Checksum Mismatch on Legacy Objects

**What you see:**

```
ERROR : file.txt: corrupted on transfer: md5 hash differ "abc123" vs "bafkr..."
```

**Why it happens:** This object was uploaded before Auto Drive introduced MD5 ETag support. Legacy objects use the CID (Content Identifier) as the ETag rather than an MD5 hash. rclone interprets the CID as a failed checksum.

**Solution:** Add `--ignore-checksum` to your command for these legacy objects:

```bash
rclone copy ./files/ autodrive:my-archive/ --immutable --ignore-checksum
```

Or use `--size-only` to skip checksum comparison entirely:

```bash
rclone copy ./files/ autodrive:my-archive/ --immutable --size-only
```

For objects uploaded after MD5 ETag support was introduced, checksums work correctly without any special flags.

---

### Delete Operation Returns 403

**What you see:**

```
ERROR : file.txt: Failed to delete: 403 Access Denied: Auto Drive storage is immutable. Objects cannot be deleted from the Autonomys DSN.
```

**Why it happens:** Auto Drive storage is permanent by design. The S3 layer rejects all DELETE requests.

**Commands affected:** `rclone delete`, `rclone purge`, `rclone rmdir`, `rclone move` (delete phase), `rclone sync` (when trying to remove files that no longer exist locally).

**Solution:** Do not attempt to delete files from Auto Drive. Use `rclone copy` instead of `rclone sync` or `rclone move` to avoid triggering delete operations.

---

### Authentication Errors

**What you see:**

```
ERROR : error listing: AccessDenied: Access Denied
```

or

```
ERROR : file.txt: Failed to copy: 401 Unauthorized
```

**Possible causes:**

1. **Invalid API key:** The API key in your rclone config is incorrect or has been revoked
2. **Expired API key:** If you set an expiry date when creating the key, it may have expired
3. **No credits:** Your Auto Drive account has no remaining storage credits

**Solutions:**

- Verify your API key at [ai3.storage](https://ai3.storage) in the Developers section
- Create a new API key if the current one has expired
- Check your credit balance at [ai3.storage](https://ai3.storage) and purchase more if needed
- Ensure the `access_key_id` in your rclone config matches your API key exactly

---

### Large File Upload Failures

**What you see:**

```
ERROR : large-file.bin: Failed to copy: 413 Request Entity Too Large
```

**Why it happens:** Single-part uploads are limited by the S3 layer's body parser. Files larger than this threshold must use multipart upload.

**Solution:** rclone uses multipart upload by default for files over 5 MB (the `--s3-chunk-size` default). If you see this error:

1. Ensure you have not set `--s3-chunk-size` to an excessively large value
2. For very large files, the default 5 MB chunk size works well:

```bash
rclone copy ./large-file.bin autodrive:my-archive/ \
  --immutable \
  --s3-chunk-size 5M
```

---

### Connection Timeouts

**What you see:**

```
ERROR : file.txt: Failed to copy: connection timed out
```

**Possible causes:**

1. Network connectivity issues between your machine and the Auto Drive endpoint
2. The Auto Drive service is temporarily unavailable
3. DNS resolution failure

**Solutions:**

- Verify connectivity: `curl -I https://public.auto-drive.autonomys.xyz/s3`
- Increase timeout with `--timeout=60s` (default is 5 minutes)
- Add retries: `--retries=5 --retries-sleep=10s`
- Check the Autonomys Network status for any outages

---

### Immutable File Conflict

**What you see:**

```
ERROR : file.txt: File exists and --immutable is set
```

**Why it happens:** You are trying to upload a file with a key that already exists, and `--immutable` is set (as recommended).

**What to do:**

- If the file is the same content, this is expected behavior - the file is already safely stored
- If you want to store a new version, use a different key (e.g., include a timestamp or version number):

```bash
rclone copy ./report.pdf autodrive:my-archive/reports/report-v2.pdf --immutable
```

**Note:** If you remove `--immutable` and upload to the same key, a new object is created and the key mapping is updated. However, the old data persists forever on the Autonomys DSN.

---

### Bucket Not Found / No Such Bucket

**What you see:**

```
ERROR : : error listing: NoSuchBucket: The specified bucket does not exist
```

**Why it happens:** You are referencing a bucket that has never had any objects written to it. Buckets in Auto Drive are created implicitly when the first object is written - they do not exist until then.

**Solution:** Write an object to the bucket first, or ensure your bucket name in the command matches one you have previously uploaded to.

Also verify that `no_check_bucket = true` is set in your rclone config. Without it, rclone may attempt a `HeadBucket` check before any operation.

---

### Listing Fails with 500 Internal Server Error

**What you see:**

```
ListObjects, ... StatusCode: 500, ... InternalServerError: Internal Server Error
```

(commands hang or fail on `rclone ls`, `rclone lsd`, `rclone check`, `rclone sync`)

**Why it happens:** Auto Drive implements the **ListObjectsV2** API only. By default rclone's generic S3 backend (`provider = Other`) uses the older **ListObjectsV1** API, which Auto Drive does not handle.

**Solution:** Set `list_version = 2` in your rclone config:

```ini
[autodrive]
...
list_version = 2
```

or on an existing remote:

```bash
rclone config update autodrive list_version 2
```

---

## Diagnostic Commands

### Check rclone configuration

```bash
rclone config show autodrive
```

### Test connectivity

```bash
curl -I https://public.auto-drive.autonomys.xyz/s3
```

### List your buckets

```bash
rclone lsd autodrive:
```

### Verbose upload with full logging

```bash
rclone copy ./test-file.txt autodrive:test-bucket/test/ \
  --immutable \
  -vv \
  --log-file=rclone-debug.log \
  --dump headers
```

### Check rclone version

```bash
rclone version
```

Ensure you are running rclone v1.60 or later for full S3 compatibility.

---

## Getting Help

- **Auto Drive:** [ai3.storage](https://ai3.storage) for account and credit issues
- **Autonomys Community:** [Discord](https://discord.gg/autonomys) or [Forum](https://forum.autonomys.xyz)
- **rclone:** [rclone Forum](https://forum.rclone.org) for rclone-specific issues
