#!/usr/bin/env bash
#
# archive-to-autodrive.sh
#
# Archives a local directory to Auto Drive using rclone.
# Designed for use with cron for scheduled archival.
#
# Usage:
#   ./archive-script.sh
#
# Cron example (daily at 2 AM):
#   0 2 * * * /path/to/archive-script.sh >> /var/log/autodrive-archive.log 2>&1
#
# Environment variables:
#   SOURCE_DIR      Local directory to archive (required if not set below)
#   BUCKET          Auto Drive bucket name (required if not set below)
#   DEST_PREFIX     Key prefix within the bucket (optional)
#   RCLONE_CONFIG   Path to rclone config file (optional, uses default if unset)

set -euo pipefail

# --- Configuration ---

# Local directory to archive
SOURCE_DIR="${SOURCE_DIR:-/path/to/your/data}"

# Auto Drive bucket name (first path segment)
BUCKET="${BUCKET:-my-archive}"

# Key prefix within the bucket (leave empty to store at the bucket root)
DEST_PREFIX="${DEST_PREFIX:-daily}"

# rclone remote name (must match your rclone.conf)
REMOTE="autodrive"

# Number of parallel file transfers
TRANSFERS="${TRANSFERS:-4}"

# --- End Configuration ---

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] Starting archive: $SOURCE_DIR -> $REMOTE:$BUCKET/$DEST_PREFIX/"

if [ ! -d "$SOURCE_DIR" ]; then
    echo "[$TIMESTAMP] ERROR: Source directory does not exist: $SOURCE_DIR"
    exit 1
fi

rclone copy \
    "$SOURCE_DIR" \
    "$REMOTE:$BUCKET/$DEST_PREFIX/" \
    --immutable \
    --transfers "$TRANSFERS" \
    -v

EXIT_CODE=$?
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

if [ $EXIT_CODE -eq 0 ]; then
    echo "[$TIMESTAMP] Archive completed successfully."
else
    echo "[$TIMESTAMP] Archive failed with exit code $EXIT_CODE."
    exit $EXIT_CODE
fi
