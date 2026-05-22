# Workflows

Common recipes for using rclone with Auto Drive. Each workflow is self-contained and includes the specific commands you need.

All workflows assume you have completed the [Setup Guide](setup.md) and have a working `autodrive` remote configured.

**Storage costs:** All operations that write data consume credits from your Auto Drive account. Credits are denominated in AI3. Check your balance at [ai3.storage](https://ai3.storage). See [Setup Guide - Purchase Storage Credits](setup.md#3-purchase-storage-credits-optional) for purchasing details.

---

## 1. Archive Local Files to Auto Drive

Store a local directory permanently on the Autonomys DSN.

```bash
rclone copy ./important-data/ autodrive:my-archive/important-data/ \
  --immutable \
  -v
```

**What happens:**
- Every file in `./important-data/` is uploaded to Auto Drive under the bucket `my-archive`, key prefix `important-data/`
- Files are stored permanently on the Autonomys DSN - they cannot be deleted or modified
- Files larger than 5 MB automatically use multipart upload
- `--immutable` ensures rclone will not attempt to overwrite a file that already exists at the same key

**Re-running the same command:** If you run the command again after adding new files, only the new files are uploaded (existing keys are skipped due to `--immutable`). This makes the command safe to run repeatedly and large transfers resumable.

**Cost note:** Each file upload consumes credits. The cost depends on the file size and the current storage price on the network. Check [ai3.storage](https://ai3.storage) for your current credit balance and [Autonomys Academy](https://academy.autonomys.xyz/autonomys-network/rewards-and-fees) for how pricing works.

---

## 2. Scheduled Archival (Cron)

Automatically archive a directory on a recurring schedule using the provided [archive script](examples/archive-script.sh).

### Quick setup

```bash
# Make the script executable
chmod +x docs/rclone/examples/archive-script.sh

# Edit the script to set your source directory, bucket, and destination prefix
# Then add it to cron (runs daily at 2 AM):
crontab -e
```

Add the line:

```
0 2 * * * BUCKET=my-archive SOURCE_DIR=/path/to/data /path/to/archive-script.sh >> /var/log/autodrive-archive.log 2>&1
```

### What the script does

1. Copies all files from a source directory to Auto Drive
2. Uses `--immutable` to skip files already stored
3. Logs the operation with timestamps
4. Exits with a non-zero status on failure (useful for alerting)

See [examples/archive-script.sh](examples/archive-script.sh) for the full script with configuration options.

---

## 3. Browse and Verify Stored Files

List and browse files stored in Auto Drive.

```bash
# List all buckets
rclone lsd autodrive:

# List top-level directories in a bucket
rclone lsd autodrive:my-archive/

# List all files in a bucket
rclone ls autodrive:my-archive/

# List files under a specific prefix
rclone ls autodrive:my-archive/reports/

# Show a recursive tree
rclone tree autodrive:my-archive/

# Verify checksums against a local copy
rclone check ./local/ autodrive:my-archive/

# Read a file to stdout
rclone cat autodrive:my-archive/logs/app.log
```

---

## 4. Read-Only Mount

Mount your Auto Drive storage as a local filesystem for browsing and reading files.

```bash
# Create the mount point
mkdir -p /mnt/autodrive

# Mount as read-only (recommended)
rclone mount autodrive:my-archive/ /mnt/autodrive \
  --read-only \
  --vfs-cache-mode full \
  --vfs-read-chunk-size 5M
```

Once mounted, use standard filesystem tools to navigate and read:

```bash
ls /mnt/autodrive/
cat /mnt/autodrive/reports/q1.pdf
```

**Recommended flags for mount:**

| Flag | Purpose |
|---|---|
| `--read-only` | Prevents confusing behavior from failed write/delete operations |
| `--vfs-cache-mode full` | Caches files locally for better read performance |
| `--vfs-read-chunk-size 5M` | Reads files in 5 MB chunks for efficient streaming |

**Unmounting:**

```bash
fusermount -u /mnt/autodrive   # Linux
umount /mnt/autodrive          # macOS
```

### Write-capable mount (advanced)

A mount without `--read-only` allows creating new files via the filesystem. However:

- **Creating new files** works normally - the file is uploaded to Auto Drive
- **Deleting files** fails at the S3 layer but may appear to succeed in your file explorer. The file reappears on refresh.
- **Renaming files** fails for the same reason (rename = copy + delete)
- **Modifying files** creates a new object at the same key; the old data persists on the DSN

Use write-capable mount only if you understand these behaviors and specifically need to create new files via the filesystem.

---

## 5. Migrate from Another Cloud Provider

Copy files from any rclone-supported cloud provider to permanent storage on Auto Drive.

### From AWS S3

```bash
rclone copy s3:my-source-bucket/data/ autodrive:migrated/aws-data/ \
  --immutable \
  -v
```

### From Google Cloud Storage

```bash
rclone copy gcs:my-gcs-bucket/archives/ autodrive:migrated/gcs-archives/ \
  --immutable \
  -v
```

### From Backblaze B2

```bash
rclone copy b2:my-b2-bucket/ autodrive:migrated/b2-backup/ \
  --immutable \
  -v
```

### From any provider

The pattern is the same for any rclone remote:

```bash
rclone copy <source-remote>:<source-path>/ autodrive:<bucket>/<destination-prefix>/ \
  --immutable \
  -v
```

**Tips for large migrations:**
- Use `-v` or `--progress` to monitor progress
- Use `--transfers=4` to control the number of parallel transfers (adjust based on your bandwidth)
- Use `--log-file=migration.log` to capture a full log
- Consider running in a `screen` or `tmux` session for long-running transfers
- The `--immutable` flag makes migrations resumable - if interrupted, re-run the same command and only remaining files are transferred

**Cost note:** Migration transfers consume Auto Drive credits for every file written. For large datasets, estimate the total size first and ensure you have sufficient credits. The free tier is suitable for testing the migration workflow with a small subset before committing to a full migration.

---

## 6. CI/CD Integration

Store build artifacts, logs, or compliance records from CI/CD pipelines.

### GitHub Actions

```yaml
name: Archive Build Artifacts

on:
  push:
    branches: [main]

jobs:
  build-and-archive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: make build

      - name: Install rclone
        run: curl https://rclone.org/install.sh | sudo bash

      - name: Configure rclone
        run: |
          mkdir -p ~/.config/rclone
          cat > ~/.config/rclone/rclone.conf << 'EOF'
          [autodrive]
          type = s3
          provider = Other
          access_key_id = ${{ secrets.AUTO_DRIVE_API_KEY }}
          secret_access_key = placeholder
          endpoint = https://public.auto-drive.autonomys.xyz/s3
          no_check_bucket = true
          EOF

      - name: Archive build artifacts
        run: |
          TIMESTAMP=$(date +%Y%m%d-%H%M%S)
          COMMIT_SHA=${{ github.sha }}
          rclone copy ./dist/ \
            autodrive:ci-builds/${COMMIT_SHA}-${TIMESTAMP}/ \
            --immutable \
            -v
```

### GitLab CI

```yaml
archive-artifacts:
  stage: deploy
  image: rclone/rclone:latest
  script:
    - mkdir -p ~/.config/rclone
    - |
      cat > ~/.config/rclone/rclone.conf << 'EOF'
      [autodrive]
      type = s3
      provider = Other
      access_key_id = ${AUTO_DRIVE_API_KEY}
      secret_access_key = placeholder
      endpoint = https://public.auto-drive.autonomys.xyz/s3
      no_check_bucket = true
      EOF
    - TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    - rclone copy ./dist/ autodrive:ci-builds/${CI_COMMIT_SHA}-${TIMESTAMP}/ --immutable -v
  only:
    - main
```

### Compliance and Audit Logs

For regulatory or audit purposes, store logs that must be retained without modification:

```bash
# Archive today's application logs
rclone copy /var/log/app/ autodrive:compliance/logs/$(date +%Y/%m/%d)/ \
  --immutable \
  --include "*.log"

# Archive database backups
pg_dump mydb | rclone rcat autodrive:compliance/db-backups/$(date +%Y%m%d-%H%M%S).sql \
  --immutable
```

Permanent storage ensures these records cannot be tampered with or accidentally deleted, meeting retention requirements by design.

---

## 7. Pipe and Stream Data

Upload data from other commands directly to Auto Drive without intermediate files.

```bash
# Archive a compressed tarball
tar czf - ./project/ | rclone rcat autodrive:my-archive/archives/project-$(date +%Y%m%d).tar.gz \
  --immutable

# Store command output
mysqldump --all-databases | rclone rcat autodrive:backups/mysql-$(date +%Y%m%d).sql \
  --immutable

# Store a Docker image
docker save my-app:latest | rclone rcat autodrive:docker-images/my-app-$(date +%Y%m%d).tar \
  --immutable
```
