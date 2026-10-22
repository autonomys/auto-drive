#!/usr/bin/env bash
set -euo pipefail

test -f /run/auto-drive-test/ready
curl -fsS -o /dev/null --max-time 4 --aws-sigv4 'aws:amz:us-east-1:s3' \
  --user "$AUTO_DRIVE_TEST_ACCESS_KEY_ID:auto-drive-test" http://127.0.0.1/
