# rclone + Auto Drive

Use [rclone](https://rclone.org) to store files permanently on the [Autonomys Network](https://autonomys.xyz) via [Auto Drive](https://ai3.storage).

Auto Drive stores file content on the Autonomys Distributed Storage Network (DSN). Content written to the DSN is permanent: it cannot be erased or changed. On top of that permanent store, Auto Drive's S3 API gives you an ordinary, editable view of your files:

- **The S3 view is editable.** You can delete, rename, move, and overwrite keys. `rclone sync`, `move`, and read-write mounts work.
- **The stored data is permanent.** A delete only hides a key, and an overwrite adds a new version. No version is ever erased from the DSN.

Versioning is always on. Every version of a key stays readable by its version ID (the content's CID), so nothing you upload is lost.

## Quickstart

**1. Get an API key**

Sign up at [ai3.storage](https://ai3.storage), go to the **Developers** section, and create an API key. A free tier is available for getting started.

**2. Install rclone**

```bash
# macOS
brew install rclone

# Linux
curl https://rclone.org/install.sh | sudo bash

# Windows
winget install Rclone.Rclone
```

rclone has an `Autonomys` provider from v1.76. Until v1.76 is released, install a beta: `curl https://rclone.org/install.sh | sudo bash -s beta`.

**3. Configure the Auto Drive remote**

Create or edit `~/.config/rclone/rclone.conf`:

```ini
[autodrive]
type = s3
provider = Autonomys
access_key_id = YOUR_API_KEY_HERE
secret_access_key = placeholder
endpoint = s3.auto-drive.autonomys.xyz
```

With rclone v1.75 or earlier, use `provider = Other` and the extra options in the [Setup Guide](setup.md#older-rclone-versions-provider--other).

**4. Verify the connection**

```bash
# List your buckets
rclone lsd autodrive:

# Copy a file to permanent storage
rclone copy ./my-file.txt autodrive:my-archive/

# Download it back
rclone copy autodrive:my-archive/my-file.txt ./downloaded/
```

## Operations

| Operation | Status | Notes |
|---|---|---|
| Upload files (`copy`, `copyto`, `rcat`) | ✅ Supported | Content is stored permanently on the DSN |
| Download files (`copy`, `cat`) | ✅ Supported | Full and byte-range downloads. Free up to 100 MiB per file; larger files use download credits |
| Head/stat files | ✅ Supported | MD5 ETag, size, modification time, metadata |
| List files (`ls`, `lsl`, `lsjson`) | ✅ Supported | ListObjectsV2 |
| List directories (`lsd`, `tree`) | ✅ Supported | Virtual directories via delimiter |
| List buckets (`lsd autodrive:`) | ✅ Supported | Your own buckets only |
| Integrity check (`check`, `md5sum`) | ✅ Supported | MD5 ETags |
| Multipart upload | ✅ Supported | Used for files of 200 MiB and over |
| Delete files (`delete`, `deletefile`) | ✅ Supported | Hides the key; the data stays on the DSN |
| Rename/move (`move`, `moveto`) | ✅ Supported | Server-side copy, then delete |
| Server-side copy | ✅ Supported | No re-upload and no extra storage cost |
| Sync (`sync`) | ✅ Supported | Removed files are hidden, not erased |
| Overwrite files | ✅ Supported | Adds a new version; old versions stay readable |
| Version history (`--s3-versions`, `--s3-version-at`) | ✅ Supported | Versioning is always on |
| `purge` | ✅ Supported | Hides every file under the path. With `provider = Other` it fails (403); use `rclone delete` |
| Delete a specific version | ❌ Refused by design | Versions are permanent (403) |
| Public links (`rclone link`) | ❌ Not supported | Use the Autonomys gateway link instead |

See the [full operations reference](operations.md) for details on every rclone command.

## Bucket model

The first segment of an object key is treated as the bucket name:

| rclone command | Bucket | Key stored |
|---|---|---|
| `rclone copy ./file.txt autodrive:my-archive/` | `my-archive` | `file.txt` |
| `rclone copy ./file.txt autodrive:my-archive/sub/` | `my-archive` | `sub/file.txt` |

- **Buckets are created on first write.** There is no CreateBucket call. The `Autonomys` provider never sends one; with `provider = Other`, set `no_check_bucket = true`.
- **Buckets are private to your account.** `rclone lsd autodrive:` lists only your buckets. Two accounts can use the same bucket name without seeing each other's files.
- **Legacy keys.** Objects uploaded before bucket support was introduced (flat keys with no `/`) are in the `default` bucket.

## Permanent storage

The S3 view behaves like a versioned bucket with COMPLIANCE-mode Object Lock:

- **Delete** hides the current version behind a delete marker. If no other key in your account points at the same content, the file also moves to the Trash in the web app. You can restore it from there.
- **Overwrite** stores a new version. The previous version stays readable by version ID.
- **Destroying a version** is refused with `403 AccessDenied`, because the DSN cannot erase data.

Every upload is permanent storage and uses credits. Deleting a key does not refund credits.

Because nothing you upload can be erased, try your commands first against the [local test endpoint](setup.md#try-it-locally-first).

For archives you never want to change, add `--immutable`. rclone then refuses to replace a file that already exists at the same key with different content:

```bash
rclone copy ./files/ autodrive:my-archive/ --immutable
```

Re-running the same command uploads only the new files. This makes the command safe to repeat and large transfers resumable.

## Documentation

- [Setup Guide](setup.md): account creation, API keys, credits, full configuration reference
- [Operations Reference](operations.md): every rclone command, what works, what doesn't
- [Workflows](workflows.md): archival, migration, versioning, CI/CD, and scheduled backup recipes
- [Troubleshooting](troubleshooting.md): common errors and solutions

## Examples

- [rclone.conf.example](examples/rclone.conf.example): annotated configuration file
- [archive-script.sh](examples/archive-script.sh): cron-ready archive script
- [docker-compose.yml](examples/docker-compose.yml): rclone + Auto Drive in Docker

## Links

- [Auto Drive Dashboard](https://ai3.storage): manage your account, API keys, and credits
- [Autonomys Network](https://autonomys.xyz): the decentralized storage network
- [Autonomys Academy - Rewards and Fees](https://academy.autonomys.xyz/autonomys-network/rewards-and-fees): how storage pricing works
- [rclone Documentation](https://rclone.org/docs/): rclone reference

## License

MIT
