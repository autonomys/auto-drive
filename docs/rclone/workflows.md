# Workflows

Common recipes for using rclone with Auto Drive. Each workflow is self-contained and includes the specific commands you need.

All workflows assume you have completed the [Setup Guide](setup.md) and have a working `autodrive` remote configured.

**Storage costs:** Every upload of new content uses credits from your Auto Drive account, because the content is stored permanently. Deletes, renames, moves, and server-side copies within Auto Drive do not upload content, so they use no credits. Deleting a file does not refund its credits. Downloading a file of 100 MiB or less is free; larger downloads use download credits from your free tier. Check your balance at [ai3.storage](https://ai3.storage). See [Setup Guide - Purchase Storage Credits](setup.md#3-purchase-storage-credits-optional) for purchasing details.

---

## 1. Archive Local Files to Auto Drive

Store a local directory permanently on the Autonomys DSN.

```bash
rclone copy ./important-data/ autodrive:my-archive/important-data/ \
  --immutable \
  -v
```

**What happens:**
- Every file in `./important-data/` is uploaded to the bucket `my-archive`, under the key prefix `important-data/`
- The content is stored permanently on the Autonomys DSN
- Files of 200 MiB and over use multipart upload
- `--immutable` makes rclone refuse to replace a file that already exists at the same key with different content

**Re-running the same command:** Only new files are uploaded; files that are already stored are skipped. This makes the command safe to repeat and large transfers resumable.

**Cost note:** Each file upload uses credits. The cost depends on the file size and the current storage price on the network. Check [ai3.storage](https://ai3.storage) for your current credit balance and [Autonomys Academy](https://academy.autonomys.xyz/autonomys-network/rewards-and-fees) for how pricing works.

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
2. Uses `--immutable` to skip files already stored and to refuse changes to them
3. Logs the operation with timestamps
4. Exits with a non-zero status on failure (useful for alerting)

See [examples/archive-script.sh](examples/archive-script.sh) for the full script with configuration options.

---

## 3. Mirror a Directory (Sync)

Keep a copy in Auto Drive that matches a local directory, including removals.

```bash
rclone sync ./project/ autodrive:my-archive/project-mirror/ -v
```

- New and changed files are uploaded. A changed file becomes a new version of its key.
- Files you removed locally are deleted at the destination. They disappear from listings, but their content stays on the DSN and earlier versions stay readable.

To keep replaced and removed files at a readable path, add a backup directory. rclone moves them there server-side, at no extra cost:

```bash
rclone sync ./project/ autodrive:my-archive/project-mirror/ \
  --backup-dir autodrive:my-archive/project-history/$(date +%Y%m%d) \
  -v
```

---

## 4. Browse and Verify Stored Files

```bash
# List your buckets
rclone lsd autodrive:

# List top-level directories in a bucket
rclone lsd autodrive:my-archive/

# List all files in a bucket, with modification times
rclone lsl autodrive:my-archive/

# Show a recursive tree
rclone tree autodrive:my-archive/

# Verify checksums against a local copy
rclone check ./local/ autodrive:my-archive/

# Read a file to stdout
rclone cat autodrive:my-archive/logs/app.log
```

---

## 5. Recover an Overwritten or Deleted File

Every version of every key stays readable, because the DSN never erases data.

```bash
# Show all versions under a prefix, including deleted and overwritten files
rclone ls --s3-versions autodrive:my-archive/reports/
```

Older versions appear with a timestamp suffix, for example `q1-v2026-09-01-120000-000.pdf`. Copy one back to restore it:

```bash
rclone copyto --s3-versions \
  autodrive:my-archive/reports/q1-v2026-09-01-120000-000.pdf \
  ./q1-restored.pdf
```

Or restore a whole directory as it was at a point in time:

```bash
rclone copy --s3-version-at "2026-09-01 00:00:00" \
  autodrive:my-archive/reports/ ./reports-2026-09-01/
```

A deleted file whose content is not used by any other key is also in the Trash at [ai3.storage](https://ai3.storage). Restoring it there makes the key visible again.

---

## 6. Reorganize Files

Rename and move files inside Auto Drive. These are server-side operations: nothing is re-uploaded and no credits are used.

```bash
# Rename a file
rclone moveto autodrive:my-archive/draft.pdf autodrive:my-archive/final.pdf

# Move a directory into another bucket
rclone move autodrive:my-archive/2025/ autodrive:cold-archive/2025/ -v

# Copy a directory to a second location
rclone copy autodrive:my-archive/reports/ autodrive:shared/reports/
```

With `provider = Other`, files of about 4.6 GiB and over cannot be copied server-side. Add `--disable copy` to have rclone download and re-upload them, or use the `Autonomys` provider, which copies files of any size.

---

## 7. Mount

Mount your Auto Drive storage as a local filesystem.

```bash
mkdir -p /mnt/autodrive

# Read-only (recommended for browsing)
rclone mount autodrive:my-archive/ /mnt/autodrive \
  --read-only \
  --vfs-cache-mode full \
  --vfs-read-chunk-size 5M
```

Once mounted, use standard filesystem tools:

```bash
ls /mnt/autodrive/
cat /mnt/autodrive/reports/q1.pdf
```

### Read-write mount

```bash
rclone mount autodrive:my-archive/ /mnt/autodrive \
  --vfs-cache-mode writes
```

Creating, renaming, and deleting files all work. Each save of a file uploads a new version and uses credits, so applications that save often can use more storage than you expect. Use a read-only mount unless you need to write.

**Unmounting:**

```bash
fusermount -u /mnt/autodrive   # Linux
umount /mnt/autodrive          # macOS
```

---

## 8. Migrate from Another Cloud Provider

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
- Use `--progress` to monitor progress
- Use `--transfers=4` to control the number of parallel transfers (adjust based on your bandwidth)
- Use `--log-file=migration.log` to capture a full log
- Run long transfers in a `screen` or `tmux` session
- If interrupted, re-run the same command: only the remaining files are transferred
- Run `rclone check <source> autodrive:<destination>` afterwards to verify every file

**Cost note:** A migration uses credits for every file written. For large datasets, check the total size first with `rclone size <source-remote>:<source-path>` and make sure you have enough credits. Test the workflow on a small subset first, against the [local test image](setup.md#try-it-locally-first) or with the free tier, before you migrate everything.

---

## 9. CI/CD Integration

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

      # The Autonomys provider needs rclone v1.76 or later. Until v1.76 is
      # released, install a beta: `sudo bash -s beta`.
      - name: Install rclone
        run: curl https://rclone.org/install.sh | sudo bash -s beta

      - name: Archive build artifacts
        env:
          RCLONE_CONFIG_AUTODRIVE_TYPE: s3
          RCLONE_CONFIG_AUTODRIVE_PROVIDER: Autonomys
          RCLONE_CONFIG_AUTODRIVE_ACCESS_KEY_ID: ${{ secrets.AUTO_DRIVE_API_KEY }}
          RCLONE_CONFIG_AUTODRIVE_SECRET_ACCESS_KEY: placeholder
          RCLONE_CONFIG_AUTODRIVE_ENDPOINT: s3.auto-drive.autonomys.xyz
        run: |
          TIMESTAMP=$(date +%Y%m%d-%H%M%S)
          rclone copy ./dist/ \
            "autodrive:ci-builds/${GITHUB_SHA}-${TIMESTAMP}/" \
            --immutable \
            -v
```

The `RCLONE_CONFIG_<REMOTE>_<OPTION>` variables define the remote without writing a config file, so the API key never touches the disk.

### GitLab CI

```yaml
archive-artifacts:
  stage: deploy
  # The Autonomys provider needs rclone v1.76 or later. Until v1.76 is
  # released, use the beta image.
  image: rclone/rclone:beta
  variables:
    RCLONE_CONFIG_AUTODRIVE_TYPE: s3
    RCLONE_CONFIG_AUTODRIVE_PROVIDER: Autonomys
    RCLONE_CONFIG_AUTODRIVE_SECRET_ACCESS_KEY: placeholder
    RCLONE_CONFIG_AUTODRIVE_ENDPOINT: s3.auto-drive.autonomys.xyz
  script:
    # AUTO_DRIVE_API_KEY is a masked CI/CD variable
    - export RCLONE_CONFIG_AUTODRIVE_ACCESS_KEY_ID="${AUTO_DRIVE_API_KEY}"
    - TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    - rclone copy ./dist/ "autodrive:ci-builds/${CI_COMMIT_SHA}-${TIMESTAMP}/" --immutable -v
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

### Compliance and Audit Logs

For regulatory or audit purposes, store logs that must be retained without modification:

```bash
# Archive today's application logs
rclone copy /var/log/app/ autodrive:compliance/logs/$(date +%Y/%m/%d)/ \
  --immutable \
  --include "*.log"

# Archive database backups
pg_dump mydb | rclone rcat autodrive:compliance/db-backups/$(date +%Y%m%d-%H%M%S).sql
```

The content of every version is stored permanently and cannot be erased, even if a key is later deleted or overwritten. This is the same guarantee as an S3 bucket with COMPLIANCE-mode Object Lock. Each version's CID identifies its exact content, so you can prove later that a record has not changed.

---

## 10. Pipe and Stream Data

Upload data from other commands directly to Auto Drive without intermediate files.

```bash
# Archive a compressed tarball
tar czf - ./project/ | rclone rcat autodrive:my-archive/archives/project-$(date +%Y%m%d).tar.gz

# Store command output
mysqldump --all-databases | rclone rcat autodrive:backups/mysql-$(date +%Y%m%d).sql

# Store a Docker image
docker save my-app:latest | rclone rcat autodrive:docker-images/my-app-$(date +%Y%m%d).tar
```

---

## 11. Share a File Publicly

`rclone link` does not work with Auto Drive. Share the file's permanent gateway link instead.

```bash
# Get the file's CID
rclone lsjson --metadata autodrive:my-archive/report.pdf
```

Find `cid` in the `Metadata` field of the output. The public link is:

```
https://gateway.autonomys.xyz/file/<CID>
```

The link points at that exact content and never changes. If you upload a new version of the file, the new version has a new CID and a new link.
