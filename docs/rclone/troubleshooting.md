# Troubleshooting

Common errors and solutions when using rclone with Auto Drive.

## Recommended Flags

| Flag | Purpose | When to use |
|---|---|---|
| `-v` / `--verbose` | Show detailed transfer information | Debugging any issue |
| `--log-file=FILE` | Write detailed logs to a file | Diagnosing intermittent failures |
| `--ignore-checksum` | Skip MD5 checksum verification | Legacy objects without MD5 ETags |
| `--size-only` | Use file size instead of checksum for change detection | Alternative to `--ignore-checksum` for legacy objects |
| `--retries=N` | Retry failed operations | Unreliable networks, throttling |

---

## Error Reference

### Listing Fails (404 NoSuchKey)

**What you see:**

```
ListObjects, ... StatusCode: 404, ... NoSuchKey: The specified key does not exist
```

(`rclone ls`, `lsd`, `check`, and `sync` all fail.)

**Why it happens:** Auto Drive implements the **ListObjectsV2** API only. With `provider = Other`, rclone uses the older **ListObjectsV1** API by default. Auto Drive does not recognise it and treats the request as a download of a missing key.

**Solution:** Set `list_version = 2` in your rclone config:

```bash
rclone config update autodrive list_version 2
```

---

### Authentication Errors (403 InvalidAccessKeyId)

**What you see:**

```
InvalidAccessKeyId: ... StatusCode: 403
```

**Possible causes:**

1. **Invalid API key:** The API key in your rclone config is incorrect or has been deleted
2. **Expired API key:** If you set an expiry date when creating the key, it may have expired

**Solutions:**

- Check your API keys at [ai3.storage](https://ai3.storage) in the Developers section. The table shows each key's expiry.
- Create a new API key if the current one has expired
- Make sure the `access_key_id` in your rclone config matches your API key exactly

rclone does not retry this error, because a rejected key will not start working on its own. A `503 ServiceUnavailable` during sign-in is different: it is temporary, and rclone retries it.

---

### Out of Credits (402 PaymentRequired)

**What you see:**

```
PaymentRequired: ... StatusCode: 402
```

**Why it happens:** Your account does not have enough storage credits for the upload.

**Solution:** Check your balance at [ai3.storage](https://ai3.storage) and purchase more credits. See [Setup Guide - Purchase Storage Credits](setup.md#3-purchase-storage-credits-optional). Downloads, listings, deletes, renames, and server-side copies do not need credits and keep working.

---

### Purge Fails (403 AccessDenied)

**What you see:**

```
ERROR : file.txt: Couldn't delete: AccessDenied: Versions are permanent and cannot be destroyed. ...
```

**Why it happens:** Auto Drive reports versioning as enabled, so `rclone purge` tries to delete every version of every file. Versions on the DSN cannot be destroyed. Commands that delete a specific version (`deletefile --s3-versions`, `backend cleanup-hidden`) fail the same way.

**Solution:** Use `rclone delete` to hide the current files:

```bash
rclone delete autodrive:my-archive/old/
```

---

### Large File Upload Fails (413 EntityTooLarge)

**What you see:**

```
EntityTooLarge: ... StatusCode: 413
```

**Why it happens:** Auto Drive accepts requests of up to 200 MiB. rclone sends files below `--s3-upload-cutoff` as one request, and larger files as multipart parts of `--s3-chunk-size`. With rclone's defaults (200 MiB cutoff, 5 MiB parts) every request fits. This error means one of these options is set higher than 200M.

**Solution:** Remove the setting, or set it to 200M or lower:

```bash
rclone copy ./large-file.bin autodrive:my-archive/ \
  --s3-upload-cutoff 200M \
  --s3-chunk-size 64M
```

---

### Throttling (503 SlowDown / ServiceUnavailable)

**What you see:** In verbose output, retries after `503` responses. If all retries fail:

```
ERROR : file.txt: Failed to copy: ... StatusCode: 503
```

**Why it happens:** The S3 endpoint limits how many requests and connections each client can make. Requests above the limit get a `503`, which rclone retries with backoff.

**Solutions:**

- Lower parallelism: `--transfers=4 --checkers=8`
- Limit the request rate: `--tpslimit 50`
- Add retries: `--retries=5 --low-level-retries=20`

---

### Recently Uploaded File Is Temporarily Unavailable (503 ServiceUnavailable)

**What you see:** A download of a file you uploaded recently fails with `503 ServiceUnavailable`, and the response includes a `Retry-After` header.

**Why it happens:** After an upload, Auto Drive moves the file's data through its processing and archiving pipeline. For a short time a single object may not be ready to serve. Nothing is lost, and the error is temporary.

**Solution:** rclone retries `503` automatically. If it still fails, wait a few minutes and run the command again.

---

### Checksum Mismatch on Legacy Objects

**What you see:**

```
ERROR : file.txt: corrupted on transfer: md5 hash differ "abc123" vs "bafkr..."
```

**Why it happens:** This object was uploaded before Auto Drive introduced MD5 ETags. Legacy objects use their CID (Content Identifier) as the ETag, and rclone reads the CID as a wrong checksum.

**Solution:** Add `--ignore-checksum` to the command:

```bash
rclone copy autodrive:my-archive/ ./restore/ --ignore-checksum
```

Or use `--size-only` to compare files by size:

```bash
rclone check ./files/ autodrive:my-archive/ --size-only
```

---

### Immutable File Conflict

**What you see:**

```
ERROR : file.txt: Source and destination exist but do not match: immutable file modified
```

**Why it happens:** `--immutable` is set and a file with different content already exists at the same key.

**What to do:**

- If you want to keep both, upload the new file under a different key (for example with a version number or date):

```bash
rclone copyto ./report.pdf autodrive:my-archive/reports/report-v2.pdf
```

- If you want to replace the file, run the command without `--immutable`. The new content becomes the current version, and the old version stays readable with `--s3-versions`.

---

### Files Are Missing From a Listing

**What you see:** `rclone ls` or `lsd` does not show files you expect.

**Possible causes:**

1. **A different API key.** Buckets are private to the account. Keys from another account see a different set of buckets, even with the same bucket name.
2. **The files were deleted.** Deleted files are hidden from listings. Check with `rclone ls --s3-versions autodrive:my-archive/`. If a deleted file is in the Trash at [ai3.storage](https://ai3.storage), you can restore it there.
3. **Legacy keys.** Objects uploaded with a key that has no `/` are in the `default` bucket: `rclone ls autodrive:default/`.

---

### Public Link Does Not Open

**What you see:** The URL from `rclone link` returns an error in the browser.

**Why it happens:** Auto Drive does not accept presigned S3 URLs.

**Solution:** Share the file's gateway link, `https://gateway.autonomys.xyz/file/<CID>`. Get the CID with `rclone lsjson --metadata autodrive:path/to/file` (field `cid`).

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

- Verify connectivity: `curl -I https://s3.auto-drive.autonomys.xyz`
- Increase timeout with `--timeout=10m` (default is 5 minutes)
- Add retries: `--retries=5 --retries-sleep=10s`
- Check the Autonomys Network status for any outages

---

### Corrupted Download of a Gzip-Encoded File

**What you see:** A file uploaded with `Content-Encoding: gzip` downloads decompressed, with a size or checksum mismatch.

**Why it happens:** Your remote uses the older endpoint `https://public.auto-drive.autonomys.xyz/s3`, which runs through a CDN that decompresses these files.

**Solution:** Switch to the dedicated S3 endpoint:

```bash
rclone config update autodrive endpoint https://s3.auto-drive.autonomys.xyz
```

---

## Diagnostic Commands

### Check rclone configuration

```bash
rclone config show autodrive
```

### Test connectivity

```bash
curl -I https://s3.auto-drive.autonomys.xyz
```

### List your buckets

```bash
rclone lsd autodrive:
```

### Verbose upload with full logging

```bash
rclone copy ./test-file.txt autodrive:test-bucket/test/ \
  -vv \
  --log-file=rclone-debug.log \
  --dump headers
```

`--dump headers` writes your API key to the log (in the `Authorization` header). Remove it before you share the log.

### Check rclone version

```bash
rclone version
```

Use a recent rclone release. `--s3-versions` needs v1.59 or later, and `--s3-version-at` needs v1.61 or later.

---

## Getting Help

- **Auto Drive:** [ai3.storage](https://ai3.storage) for account and credit issues
- **Autonomys Community:** [Discord](https://discord.gg/autonomys) or [Forum](https://forum.autonomys.xyz)
- **rclone:** [rclone Forum](https://forum.rclone.org) for rclone-specific issues
