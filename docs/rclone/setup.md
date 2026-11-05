# Setup Guide

This guide walks you through configuring rclone to use Auto Drive as a permanent storage backend.

## 1. Create an Auto Drive Account

Go to [ai3.storage](https://ai3.storage) and sign in with Google, Discord, GitHub, or an EVM wallet. This creates your Auto Drive account and gives you access to the free tier immediately.

## 2. Create an API Key

1. Sign in at [ai3.storage](https://ai3.storage)
2. Navigate to the **Developers** section
3. Click **Create API Key**
4. Give the key a descriptive name (e.g., `rclone-backup`)
5. Optionally set an expiry date
6. Copy the API key and store it securely - it will not be shown again

The API key is your S3 access key. Auto Drive does not check the secret key or the request signature, so anyone who has the API key has full access to your files. Keep it secret.

## 3. Purchase Storage Credits (Optional)

A free tier is available for development and testing. For production workloads, purchase credits:

1. Sign in at [ai3.storage](https://ai3.storage) with Google (purchases require a Google sign-in)
2. Connect an EVM-compatible wallet (MetaMask, etc.)
3. Select the amount of storage credits to purchase
4. Choose the payment method: AI3 or USDC (USDC can be temporarily unavailable; AI3 is always offered)
5. Confirm the transaction in your wallet

Storage pricing reflects the on-chain storage cost plus a service fee. For details, see the [Autonomys Academy](https://academy.autonomys.xyz/autonomys-network/rewards-and-fees).

Credits are used when content is uploaded. Deletes, renames, and server-side copies do not upload new content, so they use no credits, and a delete does not refund any.

Downloads have their own allowance. Reading a file of 100 MiB or less is free. Reading a larger file uses download credits from your free tier, for the bytes read (a byte-range read uses only the length of the range). Purchased credits are for uploads and do not add download credits. Listings and stat calls (`HeadObject`) are always free.

## 4. Install rclone

### macOS

```bash
brew install rclone
```

### Linux

```bash
curl https://rclone.org/install.sh | sudo bash
```

Or via your package manager:

```bash
# Debian/Ubuntu
sudo apt install rclone

# Fedora
sudo dnf install rclone

# Arch
sudo pacman -S rclone
```

Distribution packages can be several releases behind. If a command or flag in this guide is missing, install the latest version with the script above.

### rclone version

rclone has an `Autonomys` provider from v1.76. Until v1.76 is released, install a beta:

```bash
curl https://rclone.org/install.sh | sudo bash -s beta
```

Betas for all platforms are also at [beta.rclone.org](https://beta.rclone.org). With v1.75 or earlier, see [Older rclone versions](#older-rclone-versions-provider--other).

### Windows

```powershell
winget install Rclone.Rclone
```

Or download from [rclone.org/downloads](https://rclone.org/downloads/).

### Verify installation

```bash
rclone version
```

## 5. Configure the Auto Drive Remote

### Option A: Edit the config file directly

Create or edit `~/.config/rclone/rclone.conf` (Linux/macOS) or `%APPDATA%\rclone\rclone.conf` (Windows):

```ini
[autodrive]
type = s3
provider = Autonomys
access_key_id = YOUR_API_KEY_HERE
secret_access_key = placeholder
endpoint = s3.auto-drive.autonomys.xyz
```

### Option B: Use rclone config interactively

```bash
rclone config
```

1. Select `n` for new remote
2. Name it `autodrive`
3. Select `s3` (Amazon S3 Compliant Storage Providers)
4. Select `Autonomys` as the provider
5. Enter `false` for `env_auth`
6. Enter your API key as the `access_key_id`
7. Enter `placeholder` (or any non-empty value) for `secret_access_key`
8. Select `s3.auto-drive.autonomys.xyz` as the endpoint
9. Accept defaults for all remaining options

### Configuration notes

| Option | Value | Notes |
|---|---|---|
| `type` | `s3` | Use the S3 backend |
| `provider` | `Autonomys` | Auto Drive provider, rclone v1.76 and later |
| `access_key_id` | Your API key | Obtain from the Developers section in the web UI |
| `secret_access_key` | Any non-empty string | Required by rclone but ignored by Auto Drive |
| `endpoint` | `s3.auto-drive.autonomys.xyz` | Auto Drive S3 API |

The `Autonomys` provider sets everything else Auto Drive needs:

- It never checks or creates buckets. Auto Drive has no bucket-level endpoints, and buckets are created on first write.
- It lists with ListObjectsV2 and URL-encoded keys.
- It copies files server-side in one request at any size. Auto Drive does not implement UploadPartCopy.
- `rclone purge` hides every file under a path, instead of trying to delete every version.

**Use the `s3.` endpoint.** The older `https://public.auto-drive.autonomys.xyz/s3` endpoint still works for existing clients, but it runs through a CDN that can decompress objects stored with `Content-Encoding: gzip`. The `s3.auto-drive.autonomys.xyz` endpoint returns stored bytes exactly.

### Older rclone versions (`provider = Other`)

rclone v1.75 and earlier have no `Autonomys` provider. Use the generic provider and set the options it does not set for you:

```ini
[autodrive]
type = s3
provider = Other
access_key_id = YOUR_API_KEY_HERE
secret_access_key = placeholder
endpoint = https://s3.auto-drive.autonomys.xyz
no_check_bucket = true
list_version = 2
list_url_encode = true
```

| Option | Value | Notes |
|---|---|---|
| `no_check_bucket` | `true` | **Required.** Auto Drive has no bucket-level endpoints (CreateBucket, HeadBucket) |
| `list_version` | `2` | **Required.** Auto Drive implements ListObjectsV2 only. With `provider = Other`, rclone defaults to V1 and listing fails |
| `list_url_encode` | `true` | Recommended. Keys with special characters list correctly. With `provider = Other`, rclone defaults to off |

With `provider = Other`, two commands behave differently:

- `rclone purge` fails with `403 AccessDenied`. Use `rclone delete` instead.
- Files of about 4.6 GiB and over cannot be copied or moved server-side. Add `--disable copy` to have rclone download and re-upload them.

### Try it locally first

Everything you upload to Auto Drive is permanent. To try commands and scripts without writing permanent data or using credits, run the Auto Drive test image. It runs the same S3 API on local storage, and nothing it stores reaches the network:

```bash
docker run --rm -d -p 127.0.0.1:28640:80 ghcr.io/autonomys/auto-drive-test
```

```ini
[autodrive-test]
type = s3
provider = Autonomys
endpoint = http://127.0.0.1:28640
access_key_id = 0123456789abcdef0123456789abcdef
secret_access_key = auto-drive-test
```

The container starts empty, and its data is lost when it stops. See the [test image README](../../docker/auto-drive-test/README.md) for details.

### Local development

To run rclone against an Auto Drive backend that you build from source, start the download API (`yarn backend start:download`). It serves the S3 API under `/s3` on its port (default 3000):

```ini
endpoint = http://localhost:3000/s3
```

## 6. Verify the Connection

```bash
# List your buckets (empty if you haven't uploaded anything yet)
rclone lsd autodrive:

# Upload a test file
echo "Hello, Autonomys!" > /tmp/test-autodrive.txt
rclone copy /tmp/test-autodrive.txt autodrive:test-bucket/ -v

# Download it back
rclone cat autodrive:test-bucket/test-autodrive.txt
```

You should see `Hello, Autonomys!` printed to the terminal.

## Bucket model

Auto Drive treats the **first segment** of an object key as the bucket name. When you copy files to `autodrive:my-archive/`, rclone uses `my-archive` as the bucket and the remaining path as the key:

| rclone path | Bucket | Key |
|---|---|---|
| `autodrive:my-archive/file.txt` | `my-archive` | `file.txt` |
| `autodrive:my-archive/sub/file.txt` | `my-archive` | `sub/file.txt` |

Buckets do not need to be created in advance - they appear automatically when the first object is written to them. Buckets belong to your account: other users cannot see them, and they can use the same bucket names for their own files.

Objects uploaded before bucket support was introduced (flat keys with no `/`) remain accessible in the `default` bucket.

## Recommended flags

| Flag | Purpose | When to use |
|---|---|---|
| `--immutable` | Refuse to replace existing files with different content | Archives that must never change |
| `-v` / `--verbose` | Show progress and transfer details | Debugging |
| `--log-file=rclone.log` | Write logs to a file | Production and CI/CD |
| `--transfers=N` | Number of parallel transfers | Large jobs (default: 4) |

### Upload size limits

rclone sends files smaller than `--s3-upload-cutoff` (default 200 MiB) as a single request, and larger files as multipart uploads in `--s3-chunk-size` parts (default 5 MiB). Auto Drive accepts requests of up to 200 MiB. Keep `--s3-upload-cutoff` and `--s3-chunk-size` at 200M or below.
### Checksums

Auto Drive returns MD5 hashes as ETags, and keeps the MD5 that rclone attaches to multipart uploads. `rclone check` and `rclone md5sum` work without any special flags.

Objects uploaded before the MD5 ETag feature was introduced have no stored MD5. For these legacy objects, use `--ignore-checksum` or `--size-only`.

### Modification times

Auto Drive stores the modification time that rclone sends with each upload. `rclone lsl` shows the original file times, and `sync` and `copy` use them to detect changes.

## Next steps

- Read the [Operations Reference](operations.md) to understand which rclone commands work with Auto Drive
- See [Workflows](workflows.md) for common recipes (archival, migration, versioning, CI/CD)
- Check [Troubleshooting](troubleshooting.md) if you encounter errors
