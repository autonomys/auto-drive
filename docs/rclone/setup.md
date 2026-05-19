# Setup Guide

This guide walks you through configuring rclone to use Auto Drive as a permanent storage backend.

## 1. Create an Auto Drive Account

Go to [ai3.storage](https://ai3.storage) and sign in with Google, Discord, or GitHub. This creates your Auto Drive account and gives you access to the free tier immediately.

## 2. Create an API Key

1. Sign in at [ai3.storage](https://ai3.storage)
2. Navigate to the **Developers** section
3. Click **Create API Key**
4. Give the key a descriptive name (e.g., `rclone-backup`)
5. Optionally set an expiry date
6. Copy the API key and store it securely - it will not be shown again

The API key serves as the S3 access key for authentication.

## 3. Purchase Storage Credits (Optional)

A free tier is available for development and testing. For production workloads, purchase credits with AI3 tokens:

1. Sign in at [ai3.storage](https://ai3.storage) using Google auth
2. Connect an EVM-compatible wallet (MetaMask, etc.)
3. Select the amount of storage credits to purchase
4. Confirm the transaction with AI3 tokens

Storage pricing is dynamic, denominated in AI3, and reflects the on-chain storage cost plus a service fee. For details, see the [Autonomys Academy](https://academy.autonomys.xyz/autonomys-network/rewards-and-fees).

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
provider = Other
access_key_id = YOUR_API_KEY_HERE
secret_access_key = placeholder
endpoint = https://mainnet.auto-drive.autonomys.xyz/s3
no_check_bucket = true
```

### Option B: Use rclone config interactively

```bash
rclone config
```

1. Select `n` for new remote
2. Name it `autodrive`
3. Select `s3` (Amazon S3 Compliant Storage Providers)
4. Select `Other` as the provider
5. Enter your API key as the `access_key_id`
6. Enter `placeholder` (or any non-empty value) for `secret_access_key`
7. Enter `https://mainnet.auto-drive.autonomys.xyz/s3` as the endpoint
8. Accept defaults for all remaining options

Then manually add `no_check_bucket = true` to the config section.

### Configuration notes

| Option | Value | Notes |
|---|---|---|
| `type` | `s3` | Use the S3 backend |
| `provider` | `Other` | Generic S3-compatible mode - no provider-specific assumptions |
| `access_key_id` | Your API key | Obtain from the Developers tab in the web UI |
| `secret_access_key` | Any non-empty string | Required by rclone but ignored by Auto Drive |
| `endpoint` | `https://mainnet.auto-drive.autonomys.xyz/s3` | Auto Drive S3 API base URL |
| `no_check_bucket` | `true` | Skip bucket existence check - buckets are created implicitly on first write |

### Local development

```ini
endpoint = http://localhost:3000/s3
```

## 6. Verify the Connection

```bash
# List your buckets (empty if you haven't uploaded anything yet)
rclone lsd autodrive:

# Upload a test file
echo "Hello, Autonomys!" > /tmp/test-autodrive.txt
rclone copy /tmp/test-autodrive.txt autodrive:test-bucket/ --immutable -v

# Download it back
rclone cat autodrive:test-bucket/test-autodrive.txt
```

You should see `Hello, Autonomys!` printed to the terminal.

## Bucket model

Auto Drive treats the **first segment** of an object key as the bucket name. When you copy files to `autodrive:my-archive/`, rclone uses `my-archive` as the bucket and the remaining path as the key:

| rclone command | Bucket | Key |
|---|---|---|
| `autodrive:my-archive/file.txt` | `my-archive` | `file.txt` |
| `autodrive:my-archive/sub/file.txt` | `my-archive` | `sub/file.txt` |

Buckets do not need to be created in advance - they appear automatically when the first object is written to them.

Objects uploaded before bucket support was introduced (flat keys with no `/`) remain accessible in the `default` bucket.

## Recommended flags

| Flag | Purpose | When to use |
|---|---|---|
| `--immutable` | Prevent overwrite attempts on existing files | All upload commands |
| `-v` / `--verbose` | Show progress and transfer details | Debugging |
| `--log-file=rclone.log` | Write logs to a file | Production and CI/CD |
| `--transfers=N` | Number of parallel transfers | Large jobs (default: 4) |

### Note on checksums

Auto Drive returns MD5 hashes as ETags for all objects uploaded after the MD5 ETag feature was introduced. This means `rclone check` and `rclone md5sum` work correctly without any special flags.

Objects uploaded before this feature was introduced do not have a stored MD5. For these legacy objects, use `--ignore-checksum` or `--size-only` to skip checksum comparison.

## Next steps

- Read the [Operations Reference](operations.md) to understand which rclone commands work with Auto Drive
- See [Workflows](workflows.md) for common recipes (archival, migration, CI/CD)
- Check [Troubleshooting](troubleshooting.md) if you encounter errors
