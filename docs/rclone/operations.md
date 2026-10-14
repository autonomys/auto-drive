# Operations Reference

This document covers every relevant rclone command and its compatibility with Auto Drive's S3 layer.

**How Auto Drive storage works.** File content lives on the Autonomys DSN, where it is permanent. The S3 keys that point at that content can be changed like on any versioned S3 bucket:

- Deletes hide a key behind a delete marker.
- Overwrites add a new version.
- Renames are a server-side copy followed by a delete.

The only thing that is refused is destroying a version, because the DSN cannot erase data.

## Recommended Flags

| Flag | Purpose | When to use |
|---|---|---|
| `--immutable` | Refuse to replace existing files with different content | Archives that must never change |
| `-v` / `--verbose` | Show progress and transfer details | Debugging |
| `--log-file=FILE` | Write logs to a file | Production and CI/CD |
| `--transfers=N` | Number of parallel transfers (default: 4) | Large jobs |

### Note on checksums

Auto Drive returns MD5 hashes as ETags. `rclone check` and `rclone md5sum` work without any special flags.

Objects uploaded before MD5 ETags were introduced have no stored MD5 and report their CID as the ETag. For those legacy objects, add `--ignore-checksum` or `--size-only`.

---

## Uploading

### copy (upload)

Copies files from source to destination without deleting source files. The primary command for archiving to Auto Drive.

```bash
# Copy a single file
rclone copy ./report.pdf autodrive:my-archive/reports/

# Copy a directory
rclone copy ./backup/ autodrive:my-archive/backup-2026-05-03/

# Copy an archive that must never change
rclone copy ./data/ autodrive:my-archive/data/ --immutable -v
```

**Status:** Fully supported. Content is stored permanently on the Autonomys DSN. Files under 200 MiB go up as a single request; larger files use multipart upload.

### copyto

Copy a single file to a specific destination path.

```bash
rclone copyto ./local-file.txt autodrive:my-archive/archive/renamed-file.txt
```

**Status:** Fully supported.

### rcat

Upload data from stdin.

```bash
echo "log entry" | rclone rcat autodrive:my-archive/logs/entry.txt
tar czf - ./project/ | rclone rcat autodrive:my-archive/archives/project.tar.gz
```

**Status:** Supported. Useful for piping data directly to permanent storage.

### Overwriting a file

Uploading to a key that already exists makes the new content the current version. The previous version is kept and stays readable (see [Versions](#versions)). Each version is stored separately and uses credits.

Add `--immutable` to make rclone refuse instead.

---

## Downloading and reading

### copy (download)

```bash
# Download a single file
rclone copy autodrive:my-archive/reports/report.pdf ./downloaded/

# Download a directory tree
rclone copy autodrive:my-archive/backup-2026-05-03/ ./restored/
```

**Status:** Fully supported, including byte-range downloads.

### cat

Read file contents to stdout.

```bash
rclone cat autodrive:my-archive/logs/app.log

# Read part of a file
rclone cat autodrive:my-archive/logs/app.log --offset 1024 --count 512
```

**Status:** Fully supported.

---

## Listing

### ls / lsl / lsjson

List files with sizes (`ls`), with sizes and modification times (`lsl`), or as JSON (`lsjson`).

```bash
rclone ls autodrive:my-archive/
rclone lsl autodrive:my-archive/reports/

# Include metadata (Content-Type, user metadata, and the content CID)
rclone lsjson --metadata autodrive:my-archive/reports/report.pdf
```

**Status:** Fully supported. `lsl` shows the modification time rclone recorded at upload.

### lsd

List directories (common prefixes) or list all buckets.

```bash
# List your buckets
rclone lsd autodrive:

# List top-level directories in a bucket
rclone lsd autodrive:my-archive/

# List subdirectories under a prefix
rclone lsd autodrive:my-archive/reports/
```

**Status:** Fully supported. `rclone lsd autodrive:` uses ListBuckets and returns only your own buckets. Per-bucket listing uses ListObjectsV2 with a delimiter.

### tree

```bash
rclone tree autodrive:my-archive/
```

**Status:** Fully supported.

### size

Show total size and count of objects at a remote path.

```bash
rclone size autodrive:my-archive/
```

**Status:** Fully supported. Counts current versions only.

---

## Verifying

### md5sum / check

```bash
rclone md5sum autodrive:my-archive/
rclone check ./local/ autodrive:my-archive/
```

**Status:** Fully supported for objects with MD5 ETags, including rclone multipart uploads. For legacy objects (uploaded before MD5 ETags were introduced), use `--ignore-checksum` or `--size-only`.

---

## Changing and removing files

### delete / deletefile

```bash
# Delete everything under a prefix
rclone delete autodrive:my-archive/old-reports/

# Delete one file
rclone deletefile autodrive:my-archive/reports/draft.pdf
```

**Status:** Supported. The key is hidden behind a delete marker and no longer appears in listings. The content stays on the DSN:

- If no other key in your account points at the same content, the file moves to the Trash in the web app at [ai3.storage](https://ai3.storage). Restoring it there makes the key visible again.
- Earlier versions of the key stay readable with `--s3-versions`.

### move / moveto

```bash
# Rename a file
rclone moveto autodrive:my-archive/draft.pdf autodrive:my-archive/final.pdf

# Move a directory to another bucket
rclone move autodrive:my-archive/2025/ autodrive:cold-archive/2025/

# Upload local files, then remove the local copies
rclone move ./outbox/ autodrive:my-archive/inbox/
```

**Status:** Supported. Moves within Auto Drive are a server-side copy followed by a delete. No data is re-uploaded and no extra credits are used.

### Server-side copy

```bash
rclone copy autodrive:my-archive/reports/ autodrive:shared-reports/
```

**Status:** Supported. The new key points at the existing content, so nothing is re-uploaded and no extra credits are used.

Exception: files of about 4.6 GiB or more (rclone's `--s3-copy-cutoff`) cannot be copied server-side, because Auto Drive does not implement UploadPartCopy (`501 NotImplemented`). To copy or move such a file, add `--disable copy` so rclone downloads and re-uploads it instead.

### sync

```bash
rclone sync ./local/ autodrive:my-archive/mirror/
```

**Status:** Supported. New and changed files are uploaded. Files that are no longer in the source are deleted at the destination, which hides them. Their content stays on the DSN.

Add `--backup-dir` to move replaced and removed files to another path instead (server-side, at no extra cost):

```bash
rclone sync ./local/ autodrive:my-archive/mirror/ \
  --backup-dir autodrive:my-archive/mirror-history/$(date +%Y%m%d)
```

### mount

Mount the remote as a filesystem via FUSE.

```bash
mkdir -p /mnt/autodrive

# Read-only mount (recommended for browsing)
rclone mount autodrive:my-archive/ /mnt/autodrive \
  --read-only \
  --vfs-cache-mode full \
  --vfs-read-chunk-size 5M

# Read-write mount
rclone mount autodrive:my-archive/ /mnt/autodrive \
  --vfs-cache-mode writes
```

| Flag | Purpose |
|---|---|
| `--read-only` | Browse without the risk of accidental writes |
| `--vfs-cache-mode full` | Caches files locally for better read performance |
| `--vfs-cache-mode writes` | Needed for applications that edit files in place |
| `--vfs-read-chunk-size 5M` | Reads files in 5 MB chunks for efficient streaming |

**Status:** Supported, read-only and read-write. In a read-write mount, every save of a file uploads a new version and uses credits. Editors that save often can use more storage than you expect.

**Unmounting:**

```bash
fusermount -u /mnt/autodrive   # Linux
umount /mnt/autodrive          # macOS
```

---

## Versions

Versioning is always on and cannot be turned off. Each version's ID is the content's CID.

```bash
# List all versions, including hidden and overwritten ones
rclone ls --s3-versions autodrive:my-archive/reports/

# Read the bucket as it was at a point in time
rclone copy --s3-version-at "2026-09-01 00:00:00" \
  autodrive:my-archive/reports/ ./reports-as-of-sept/

# Check that versioning is enabled
rclone backend versioning autodrive:my-archive
```

With `--s3-versions`, older versions appear with a timestamp suffix in the file name (for example `report-v2026-09-01-120000-000.pdf`). You can copy them like any other file.

Versions are permanent. Commands that destroy versions are refused with `403 AccessDenied`:

- `rclone deletefile --s3-versions` on an old version
- `rclone backend cleanup-hidden`
- `rclone purge` (see below)

---

## Links

### link

```bash
rclone link autodrive:my-archive/report.pdf
```

**Status:** Not supported. rclone builds a presigned S3 URL, but Auto Drive authenticates with API keys and does not accept presigned URLs. The link will not open.

To share a file publicly, use its permanent content-addressed link on the Autonomys gateway:

```
https://gateway.autonomys.xyz/file/<CID>
```

The CID is in the file's metadata as `cid`:

```bash
rclone lsjson --metadata autodrive:my-archive/report.pdf
```

A gateway link is public: anyone who has it can read the file.

---

## Not supported

### purge

```bash
rclone purge autodrive:my-archive/old/
```

**What you see:** `403 AccessDenied` errors.

**Why:** Auto Drive reports versioning as enabled. rclone's `purge` then tries to delete every version of every file, and versions cannot be destroyed. The same thing happens on any S3 bucket with COMPLIANCE-mode Object Lock.

**Instead:** use `rclone delete`, which hides all current files under the path:

```bash
rclone delete autodrive:my-archive/old/
```

Directories are virtual, so the path disappears once it has no visible files.

### mkdir / rmdir / rmdirs

```bash
rclone mkdir autodrive:new-bucket
rclone rmdir autodrive:my-archive/empty-folder/
```

**What you see:** The command succeeds but has no effect.

**Why:** Buckets and directories are virtual. A bucket appears when you write the first file into it, and a directory disappears when it has no visible files. `rmdir` never fails, even on a path that still contains files.

### cleanup

```bash
rclone cleanup autodrive:my-archive
```

**What you see:** `501 NotImplemented`.

**Why:** `cleanup` lists incomplete multipart uploads, and Auto Drive does not implement `ListMultipartUploads`. rclone aborts its own failed multipart uploads automatically (`AbortMultipartUpload` is supported), so there is normally nothing to clean up.

### about

```bash
rclone about autodrive:
```

**What you see:** An error that the remote does not support `about`.

**Why:** There is no quota API. Check your storage and credit balance at [ai3.storage](https://ai3.storage).

---

## Operations Summary Table

| Command | Status | Notes |
|---|---|---|
| `copy` / `copyto` (upload) | ✅ Supported | Multipart from 200 MiB |
| `copy` (download) | ✅ Supported | Byte-range downloads supported |
| `cat` | ✅ Supported | Supports `--offset` / `--count` |
| `rcat` | ✅ Supported | Upload from stdin |
| `ls` / `lsl` / `lsjson` | ✅ Supported | Modification times and metadata included |
| `lsd` | ✅ Supported | Your own buckets, and directories |
| `tree` | ✅ Supported | |
| `md5sum` / `check` | ✅ Supported | Use `--ignore-checksum` for legacy objects |
| `size` | ✅ Supported | Current versions only |
| `delete` / `deletefile` | ✅ Supported | Hides the file; content stays on the DSN |
| `move` / `moveto` | ✅ Supported | Server-side copy + delete |
| server-side copy | ✅ Supported | Not for files of ~4.6 GiB and over |
| `sync` | ✅ Supported | Removed files are hidden |
| `mount` | ✅ Supported | Each save in a read-write mount is a new version |
| `--s3-versions` / `--s3-version-at` | ✅ Supported | Read old versions |
| `backend versioning` | ✅ Supported | Always `Enabled` |
| `mkdir` / `rmdir` / `rmdirs` | ⚠️ No effect | Buckets and directories are virtual |
| `link` | ❌ Not supported | Use `https://gateway.autonomys.xyz/file/<CID>` |
| `purge` | ❌ Fails (403) | Use `rclone delete` |
| delete a specific version, `backend cleanup-hidden` | ❌ Refused by design (403) | Versions are permanent |
| `cleanup` | ❌ Not implemented (501) | `ListMultipartUploads` not implemented |
| `about` | ❌ Not implemented | No quota API |
