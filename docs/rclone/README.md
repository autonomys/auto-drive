# rclone + Auto Drive

Use [rclone](https://rclone.org) to store files permanently on the [Autonomys Network](https://autonomys.xyz) via [Auto Drive](https://ai3.storage).

Auto Drive is permanent, immutable, decentralized storage. Files stored on the Autonomys Distributed Storage Network (DSN) cannot be modified, overwritten, or deleted. This is the core guarantee: your data exists forever. rclone operations that assume mutability (delete, overwrite, rename) will not work - by design.

## Quickstart

**1. Get an API key**

Sign up at [ai3.storage](https://ai3.storage), go to the Developers section, and create an API key. A free tier is available for getting started.

**2. Install rclone**

```bash
# macOS
brew install rclone

# Linux
curl https://rclone.org/install.sh | sudo bash

# Windows
winget install Rclone.Rclone
```

**3. Configure the Auto Drive remote**

Create or edit `~/.config/rclone/rclone.conf`:

```ini
[autodrive]
type = s3
provider = Other
access_key_id = YOUR_API_KEY_HERE
secret_access_key = placeholder
endpoint = https://mainnet.auto-drive.autonomys.xyz/s3
no_check_bucket = true
```

**4. Verify the connection**

```bash
# List your buckets
rclone lsd autodrive:

# Copy a file to permanent storage
rclone copy ./my-file.txt autodrive:my-archive/ --immutable

# Download it back
rclone copy autodrive:my-archive/my-file.txt ./downloaded/
```

## Operations

| Operation | Status | Notes |
|---|---|---|
| Upload files (`copy`) | ✅ Supported | Files are stored permanently |
| Download files (`copy`, `cat`) | ✅ Supported | Full and byte-range downloads |
| Head/stat files | ✅ Supported | Returns MD5 ETag, size, metadata |
| List files (`ls`, `lsl`) | ✅ Supported | Uses ListObjectsV2 |
| List directories (`lsd`, `tree`) | ✅ Supported | Virtual directory folding via delimiter |
| List buckets (`lsd autodrive:`) | ✅ Supported | Returns all your buckets |
| Integrity check (`check`, `md5sum`) | ✅ Supported | Uses MD5 ETags |
| Multipart upload | ✅ Supported | Auto-used for large files |
| Delete files | ❌ Unsupported by design | Returns 403 - storage is permanent |
| Rename/move files | ❌ Unsupported by design | Storage is immutable |
| Overwrite files | ⚠️ Creates new object | Old data persists on DSN |

See the [full operations reference](operations.md) for details on every rclone command.

## Bucket model

The first segment of an object key is treated as the bucket name:

| rclone command | Bucket | Key stored |
|---|---|---|
| `rclone copy ./file.txt autodrive:my-archive/` | `my-archive` | `file.txt` |
| `rclone copy ./file.txt autodrive:my-archive/sub/` | `my-archive` | `sub/file.txt` |

Buckets are created implicitly on first write. `rclone lsd autodrive:` lists all buckets that have been written to.

Objects uploaded before bucket support was introduced (flat keys with no `/`) are accessible in the `default` bucket.

## Immutable storage

Always use `--immutable` for upload commands. This prevents rclone from attempting to overwrite a file that already exists at the same key:

```bash
rclone copy ./files/ autodrive:my-archive/ --immutable
```

If you run the same command again, only new files are uploaded. This makes commands safe to run repeatedly and makes large transfers resumable.

## Documentation

- [Setup Guide](setup.md) - account creation, API keys, credits, full configuration reference
- [Operations Reference](operations.md) - every rclone command, what works, what doesn't
- [Workflows](workflows.md) - archival, migration, CI/CD, and scheduled backup recipes
- [Troubleshooting](troubleshooting.md) - common errors and solutions

## Examples

- [rclone.conf.example](examples/rclone.conf.example) - annotated configuration file
- [archive-script.sh](examples/archive-script.sh) - cron-ready archive script
- [docker-compose.yml](examples/docker-compose.yml) - rclone + Auto Drive in Docker

## Links

- [Auto Drive Dashboard](https://ai3.storage) - manage your account, API keys, and credits
- [Autonomys Network](https://autonomys.xyz) - the decentralized storage network
- [Autonomys Academy - Rewards and Fees](https://academy.autonomys.xyz/autonomys-network/rewards-and-fees) - how storage pricing works
- [rclone Documentation](https://rclone.org/docs/) - rclone reference

## License

MIT
