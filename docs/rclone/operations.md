# Operations Reference

This document covers every relevant rclone command and its compatibility with Auto Drive's S3 layer.

Auto Drive is permanent, immutable storage. Operations that require mutability (delete, rename, overwrite) are unsupported by design. This is the mechanism that guarantees your data can never be lost.

## Recommended Flags

| Flag | Purpose | When to use |
|---|---|---|
| `--immutable` | Prevent overwrite attempts on existing files | All upload commands |
| `-v` / `--verbose` | Show progress and transfer details | Debugging |
| `--log-file=FILE` | Write logs to a file | Production and CI/CD |
| `--transfers=N` | Number of parallel transfers (default: 4) | Large jobs |

### Note on checksums

Auto Drive returns MD5 hashes as ETags for all objects uploaded after the MD5 ETag feature was introduced. rclone's checksum verification (`rclone check`, `rclone md5sum`) works correctly for these objects without any special flags.

Objects uploaded before this feature was introduced have no stored MD5. For those legacy objects, add `--ignore-checksum` or `--size-only` to skip checksum comparison.

---

## Supported Operations

### copy (upload)

Copies files from source to destination without deleting source files. The primary command for archiving to Auto Drive.

```bash
# Copy a single file
rclone copy ./report.pdf autodrive:my-archive/reports/ --immutable

# Copy a directory
rclone copy ./backup/ autodrive:my-archive/backup-2026-05-03/ --immutable

# Copy with verbose output
rclone copy ./data/ autodrive:my-archive/data/ --immutable -v
```

**Status:** Fully supported. Each file is stored permanently on the Autonomys DSN. Files larger than 5 MB automatically use multipart upload.

### copy (download)

Download previously stored files.

```bash
# Download a single file
rclone copy autodrive:my-archive/reports/report.pdf ./downloaded/

# Download a directory tree
rclone copy autodrive:my-archive/backup-2026-05-03/ ./restored/
```

**Status:** Fully supported. Byte-range downloads are also supported.

### cat

Read file contents to stdout.

```bash
rclone cat autodrive:my-archive/logs/app.log
```

**Status:** Fully supported.

### copyto

Copy a single file to a specific destination path.

```bash
rclone copyto ./local-file.txt autodrive:my-archive/archive/renamed-file.txt --immutable
```

**Status:** Fully supported.

### rcat

Upload data from stdin.

```bash
echo "log entry" | rclone rcat autodrive:my-archive/logs/entry.txt --immutable
tar czf - ./project/ | rclone rcat autodrive:my-archive/archives/project.tar.gz --immutable
```

**Status:** Supported. Useful for piping data directly to permanent storage.

### ls / lsl

List files with sizes (`ls`) or sizes and modification times (`lsl`).

```bash
rclone ls autodrive:my-archive/
rclone ls autodrive:my-archive/reports/
rclone lsl autodrive:my-archive/
```

**Status:** Fully supported. Uses ListObjectsV2 with prefix and delimiter folding.

### lsd

List directories (common prefixes) or list all buckets.

```bash
# List buckets
rclone lsd autodrive:

# List top-level directories in a bucket
rclone lsd autodrive:my-archive/

# List subdirectories under a prefix
rclone lsd autodrive:my-archive/reports/
```

**Status:** Fully supported. Top-level `rclone lsd autodrive:` uses ListBuckets; per-bucket listing uses ListObjectsV2 with delimiter.

### tree

Display a recursive tree of the remote.

```bash
rclone tree autodrive:my-archive/
```

**Status:** Fully supported.

### md5sum / hashsum

Compute and compare MD5 checksums.

```bash
rclone md5sum autodrive:my-archive/
rclone check ./local/ autodrive:my-archive/ 
```

**Status:** Fully supported for objects uploaded after MD5 ETag support was introduced. For legacy objects (uploaded before this feature), use `--ignore-checksum` or `--size-only`.

### size

Show total size and count of objects at a remote path.

```bash
rclone size autodrive:my-archive/
rclone size autodrive:my-archive/reports/
```

**Status:** Fully supported.

### check

Compare source and destination file lists and verify integrity.

```bash
rclone check ./local/ autodrive:my-archive/
```

**Status:** Fully supported for objects with MD5 ETags. For legacy objects, use `--ignore-checksum` or `--size-only`.

---

## Supported with Caveats

### sync

Sync makes the destination match the source. With Auto Drive, only the upload side works - deletions are silently skipped or will error.

```bash
rclone sync ./local/ autodrive:my-archive/mirror/ --immutable
```

**Status:** Partially supported. New files are uploaded. Files that exist at the destination cannot be deleted or overwritten.

**Recommendation:** Use `rclone copy` instead of `rclone sync`. The sync mental model assumes the ability to delete, which does not apply to permanent storage.

### move

Move files to a destination (copy then delete source).

```bash
rclone move ./local-files/ autodrive:my-archive/archive/ --immutable
```

**Status:** Partially supported. The upload succeeds, but the local source delete depends on rclone's behavior after a successful transfer. When moving FROM Auto Drive, the download succeeds but the remote delete will fail.

### mount

Mount the remote as a filesystem via FUSE.

```bash
# Create the mount point
mkdir -p /mnt/autodrive

# Read-only mount (recommended)
rclone mount autodrive:my-archive/ /mnt/autodrive \
  --read-only \
  --vfs-cache-mode full \
  --vfs-read-chunk-size 5M
```

**Recommended flags for mount:**

| Flag | Purpose |
|---|---|
| `--read-only` | Prevents confusing behavior from failed write/delete operations |
| `--vfs-cache-mode full` | Caches files locally for better read performance |
| `--vfs-read-chunk-size 5M` | Reads files in 5 MB chunks for efficient streaming |

**Read-only mount:** Fully supported. Directory browsing works via ListObjectsV2.

**Read-write mount:** Creating new files works normally - the file is uploaded to Auto Drive. Delete and rename operations fail at the S3 layer. File explorers may show confusing behavior where deleted files reappear on refresh. Use `--read-only` unless you specifically need to create new files via the filesystem.

**Unmounting:**

```bash
fusermount -u /mnt/autodrive   # Linux
umount /mnt/autodrive          # macOS
```

---

## Unsupported by Design

These operations require mutability and will fail. This is by design - permanence is the guarantee.

### delete

```bash
rclone delete autodrive:my-archive/file.txt
```

**What you see:**

```
ERROR : file.txt: Failed to delete: 403 Access Denied: Auto Drive storage is immutable. Objects cannot be deleted from the Autonomys DSN.
```

**Why:** Auto Drive storage is permanent. Files stored on the Autonomys DSN cannot be deleted.

### purge

```bash
rclone purge autodrive:my-archive/
```

**What you see:** Same 403 error as delete.

**Why:** Cannot remove a directory and all its contents from permanent storage.

### rmdir / rmdirs

```bash
rclone rmdir autodrive:my-archive/empty-folder/
```

**What you see:** Error - folder deletion is not supported.

**Why:** The S3 layer does not implement DeleteObject.

### cleanup

```bash
rclone cleanup autodrive:
```

**What you see:** `501 NotImplemented`.

**Why:** Cleanup lists and aborts incomplete multipart uploads. Auto Drive implements neither `ListMultipartUploads` nor `AbortMultipartUpload`, so both return 501.

### mkdir

```bash
rclone mkdir autodrive:new-bucket
```

**What you see:** Error - CreateBucket is not implemented.

**Why:** Buckets are created implicitly when the first object is written to them. Explicit bucket creation is not needed and not implemented.

---

## Operations Summary Table

| Command | Status | Notes |
|---|---|---|
| `copy` (upload) | ✅ Supported | Use `--immutable` |
| `copy` (download) | ✅ Supported | Byte-range downloads supported |
| `cat` | ✅ Supported | Stream file to stdout |
| `copyto` | ✅ Supported | Copy single file to specific path |
| `rcat` | ✅ Supported | Upload from stdin |
| `ls` / `lsl` | ✅ Supported | Uses ListObjectsV2 |
| `lsd` | ✅ Supported | Bucket listing and directory listing |
| `tree` | ✅ Supported | Recursive tree via ListObjectsV2 |
| `md5sum` | ✅ Supported | MD5 ETags on new objects; use `--ignore-checksum` for legacy |
| `check` | ✅ Supported | Same caveat as `md5sum` for legacy objects |
| `size` | ✅ Supported | Aggregates across prefix |
| `mount` (read-only) | ✅ Supported | Use `--read-only --vfs-cache-mode full` |
| `sync` | ⚠️ Partial | Upload-only; deletions skipped/error; use `copy` instead |
| `move` | ⚠️ Partial | Upload works; source delete may fail |
| `mount` (read-write) | ⚠️ Partial | New files work; delete/rename fail |
| server-side copy | ❌ Not implemented | `CopyObject` returns 501; rclone falls back to download + re-upload |
| `about` | ❌ Not implemented | No quota/usage API |
| `delete` | ❌ Unsupported by design | Returns 403 - storage is permanent |
| `purge` | ❌ Unsupported by design | Returns 403 - storage is permanent |
| `rmdir` / `rmdirs` | ❌ Unsupported by design | No deletion |
| `mkdir` | ❌ Not implemented | Buckets are created implicitly on first write |
| `cleanup` | ❌ Not implemented | Returns 501; multipart-upload APIs not implemented |
