#!/usr/bin/env bash
# Starts nginx once the backend answers S3 requests, so the published port only
# accepts connections when the stack is ready, then reports readiness.
set -uo pipefail

TIMEOUT=${AUTO_DRIVE_TEST_START_TIMEOUT:-180}
deadline=$((SECONDS + TIMEOUT))

wait_for() {
  until "$@"; do
    ((SECONDS < deadline)) || return 1
    sleep 1
  done
}

s3_ok() {
  curl -fsS -o /dev/null --max-time 5 --aws-sigv4 'aws:amz:us-east-1:s3' \
    --user "$AUTO_DRIVE_TEST_ACCESS_KEY_ID:auto-drive-test" "$1" 2>/dev/null
}

healthy() {
  curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$1/health" 2>/dev/null
}

if wait_for s3_ok http://127.0.0.1:3000/s3/ &&
  wait_for healthy 3001 &&
  wait_for healthy 3002 &&
  supervisorctl -c /etc/auto-drive-test/supervisord.conf start nginx >/dev/null &&
  wait_for s3_ok http://127.0.0.1/; then
  touch /run/auto-drive-test/ready
  echo "auto-drive-test ready: S3 endpoint on port 80, access key ID $AUTO_DRIVE_TEST_ACCESS_KEY_ID"
  exit 0
fi

echo "auto-drive-test did not become ready within ${TIMEOUT}s. Recent logs:" >&2
tail -n 20 /var/log/auto-drive-test/*.log >&2
kill -TERM 1
exit 1
