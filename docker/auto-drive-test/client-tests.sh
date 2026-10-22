#!/usr/bin/env bash
# Runs rclone's S3 backend integration suite and the repository's S3 smoke
# scripts against a running auto-drive-test container.
#
# Usage: client-tests.sh <rclone source checkout>
#
# Environment:
#   AUTO_DRIVE_TEST_ENDPOINT       default http://127.0.0.1:28640
#   AUTO_DRIVE_TEST_ACCESS_KEY_ID  default the image's access key ID
#   OUTPUT_DIR                     default ./client-test-output
#
# Needs Go, the AWS CLI v2 and jq.
set -uo pipefail

RCLONE_SRC=$(cd "${1:?usage: client-tests.sh <rclone source checkout>}" && pwd) || exit 1
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
ENDPOINT=${AUTO_DRIVE_TEST_ENDPOINT:-http://127.0.0.1:28640}
KEY=${AUTO_DRIVE_TEST_ACCESS_KEY_ID:-0123456789abcdef0123456789abcdef}
mkdir -p "${OUTPUT_DIR:-client-test-output}"
OUT=$(cd "${OUTPUT_DIR:-client-test-output}" && pwd)
TIMINGS=$OUT/timings.md

export RCLONE_CONFIG=$OUT/rclone.conf
cat >"$RCLONE_CONFIG" <<EOF
[TestS3Autonomys]
type = s3
provider = Autonomys
endpoint = $ENDPOINT
access_key_id = $KEY
secret_access_key = auto-drive-test
EOF

echo "| Step | Result | Seconds |" >"$TIMINGS"
echo "|---|---|---|" >>"$TIMINGS"
failed=0
step() {
  local name=$1 start=$SECONDS result=passed
  shift
  echo "::group::$name"
  "$@" || {
    result=failed
    failed=1
  }
  echo "::endgroup::"
  echo "| $name | $result | $((SECONDS - start)) |" >>"$TIMINGS"
}

step "Build rclone" bash -c "cd '$RCLONE_SRC' && go build -o '$OUT/bin/rclone' ."
step "rclone S3 backend suite" bash -c "cd '$RCLONE_SRC' && go run ./fstest/test_all \
  -config '$HERE/rclone-test-all.yaml' -remotes TestS3Autonomys: -maxtries 3 -output '$OUT/test_all'"

export AUTO_DRIVE_ENDPOINT=$ENDPOINT AUTO_DRIVE_API_KEY=$KEY RCLONE_REMOTE=TestS3Autonomys
export PATH=$OUT/bin:$PATH
step "AWS CLI smoke script" "$REPO/scripts/live-integration/test-s3-api.sh"
step "rclone smoke script" "$REPO/scripts/live-integration/test-s3-rclone.sh"

cat "$TIMINGS"
exit "$failed"
