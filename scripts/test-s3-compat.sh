#!/usr/bin/env bash
#
# test-s3-compat.sh — Smoke tests for Auto Drive S3 API compatibility.
#
# Coverage:
#   PR 683  DeleteObject returns 403 AccessDenied (storage is immutable)
#   PR 684  Bucket support — first path segment of S3 key is the bucket name
#   PR 695  MD5 ETags — PutObject, HeadObject, x-amz-meta-cid, multipart
#
# Not covered here (PR 696 not yet deployed):
#   ListObjectsV2 — delimiter folding, continuation tokens, truncation
#
# Prerequisites:
#   aws     AWS CLI v2          https://aws.amazon.com/cli/
#   jq      JSON processor      https://stedolan.github.io/jq/
#   rclone  (optional)          https://rclone.org/ — tests skipped if absent
#
# Usage:
#   AUTO_DRIVE_API_KEY=<api_key> ./scripts/test-s3-compat.sh
#
# Optional overrides:
#   AUTO_DRIVE_ENDPOINT   default: https://public.auto-drive.autonomys.xyz/s3
#   TEST_BUCKET           default: s3-smoke-test
#   RCLONE_REMOTE         default: autodrive

set -uo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
  BOLD='\033[1m'   DIM='\033[2m'      RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' BOLD='' DIM='' RESET=''
fi

PASS=0; FAIL=0

ok()      { printf "  ${GREEN}✓${RESET}  %s\n" "$1"; PASS=$((PASS+1)); }
fail()    { printf "  ${RED}✗${RESET}  %s\n" "$1"
            [ -n "${2:-}" ] && printf "      ${DIM}%s${RESET}\n" "$2"
            FAIL=$((FAIL+1)); }
skip()    { printf "  ${YELLOW}–${RESET}  %s (skipped)\n" "$1"; }
section() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

# ── Configuration ─────────────────────────────────────────────────────────────

ENDPOINT="${AUTO_DRIVE_ENDPOINT:-https://public.auto-drive.autonomys.xyz/s3}"
API_KEY="${AUTO_DRIVE_API_KEY:-}"
TEST_BUCKET="${TEST_BUCKET:-s3-smoke-test}"
RCLONE_REMOTE="${RCLONE_REMOTE:-autodrive}"

if [[ -z "$API_KEY" ]]; then
  printf "ERROR: AUTO_DRIVE_API_KEY is required.\n"
  printf "Usage: AUTO_DRIVE_API_KEY=<key> %s\n" "$0"
  exit 1
fi

# ── Prerequisites ─────────────────────────────────────────────────────────────

for cmd in aws jq; do
  if ! command -v "$cmd" &>/dev/null; then
    printf "ERROR: '%s' is required but not found in PATH.\n" "$cmd"
    exit 1
  fi
done

HAVE_RCLONE=false
if command -v rclone &>/dev/null; then
  if rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:"; then
    HAVE_RCLONE=true
  fi
fi

# ── AWS CLI ───────────────────────────────────────────────────────────────────

export AWS_ACCESS_KEY_ID="$API_KEY"
export AWS_SECRET_ACCESS_KEY="placeholder"
export AWS_DEFAULT_REGION="us-east-1"

S3() { aws --endpoint-url "$ENDPOINT" --output json s3api "$@"; }

# ── Temp files ────────────────────────────────────────────────────────────────

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Suppress aws-chunked encoding.  AWS CLI v2 adds Content-Encoding: aws-chunked
# (and an integrity checksum trailer) by default for PutObject requests.  Our
# Express backend's raw() middleware reads bytes verbatim and does not decode
# the aws-chunked wrapper, so the stored content — and its computed MD5 — would
# be wrong.  Setting request_checksum_calculation=when_required tells the CLI
# to skip checksums unless the operation explicitly requires them.
AWS_CFG_DIR="${WORK}/aws"
mkdir -p "$AWS_CFG_DIR"
printf '[default]\nrequest_checksum_calculation = when_required\n' \
  > "${AWS_CFG_DIR}/config"
export AWS_CONFIG_FILE="${AWS_CFG_DIR}/config"

TS=$(date +%s)
OBJECT_KEY="smoke-${TS}.txt"
OBJECT_CONTENT="Auto Drive S3 smoke test — epoch ${TS}"
OBJECT_FILE="${WORK}/upload.txt"
printf '%s' "$OBJECT_CONTENT" >"$OBJECT_FILE"

# md5 -q on macOS; md5sum on Linux
EXPECTED_MD5=$(md5 -q "$OBJECT_FILE" 2>/dev/null \
  || md5sum "$OBJECT_FILE" | awk '{print $1}')

# ── Banner ────────────────────────────────────────────────────────────────────

printf "\n${BOLD}Auto Drive S3 compatibility smoke tests${RESET}\n"
printf "Endpoint  %s\n" "$ENDPOINT"
printf "Bucket    %s\n" "$TEST_BUCKET"
if $HAVE_RCLONE; then
  printf "rclone    ✓  remote '%s' configured\n" "$RCLONE_REMOTE"
else
  printf "rclone    –  remote '%s' not found; rclone tests will be skipped\n" "$RCLONE_REMOTE"
fi

# ─────────────────────────────────────────────────────────────────────────────
# PR 684 — Bucket Support
# ─────────────────────────────────────────────────────────────────────────────

section "PR 684 — Bucket support"

# PutObject — write to an explicit bucket
if S3 put-object \
    --bucket "$TEST_BUCKET" \
    --key "$OBJECT_KEY" \
    --body "$OBJECT_FILE" \
    --content-type "text/plain" >/dev/null 2>&1; then
  ok "PutObject → ${TEST_BUCKET}/${OBJECT_KEY}"
else
  fail "PutObject → ${TEST_BUCKET}/${OBJECT_KEY}" "upload failed"
fi

# GetObject — verify content round-trips correctly
DOWNLOAD="${WORK}/download.txt"
if S3 get-object \
    --bucket "$TEST_BUCKET" \
    --key "$OBJECT_KEY" \
    "$DOWNLOAD" >/dev/null 2>&1; then
  ACTUAL=$(cat "$DOWNLOAD")
  if [[ "$ACTUAL" == "$OBJECT_CONTENT" ]]; then
    ok "GetObject — content matches"
  else
    fail "GetObject — content mismatch" \
      "want: '${OBJECT_CONTENT}'  got: '${ACTUAL}'"
  fi
else
  fail "GetObject — request failed"
fi

# ListBuckets — test bucket must appear after first write
if LIST=$(S3 list-buckets 2>&1); then
  if echo "$LIST" | jq -e --arg b "$TEST_BUCKET" \
      '.Buckets[].Name | select(. == $b)' >/dev/null 2>&1; then
    ok "ListBuckets — '${TEST_BUCKET}' appears"
  else
    FOUND=$(echo "$LIST" | jq -r '[.Buckets[].Name] | join(", ")' 2>/dev/null || echo "$LIST")
    fail "ListBuckets — '${TEST_BUCKET}' not found" "buckets: ${FOUND}"
  fi
else
  fail "ListBuckets — request failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# PR 695 — MD5 ETags (PutObject / HeadObject)
# ─────────────────────────────────────────────────────────────────────────────

section "PR 695 — MD5 ETags"

if HEAD=$(S3 head-object \
    --bucket "$TEST_BUCKET" \
    --key "$OBJECT_KEY" 2>&1); then

  # ETag must be "32 lowercase hex chars"
  ETAG_RAW=$(echo "$HEAD" | jq -r '.ETag // ""')
  ETAG="${ETAG_RAW//\"/}"   # strip surrounding S3 double-quotes

  if [[ "$ETAG" =~ ^[0-9a-f]{32}$ ]]; then
    ok "HeadObject — ETag is MD5 format (${ETAG})"
    if [[ "$ETAG" == "$EXPECTED_MD5" ]]; then
      ok "HeadObject — ETag matches file MD5"
    else
      fail "HeadObject — ETag doesn't match file MD5" \
        "etag=${ETAG}  file=${EXPECTED_MD5}"
    fi
  else
    fail "HeadObject — ETag not in MD5 format" "got: '${ETAG_RAW}'"
  fi

  # x-amz-meta-cid: AWS SDK maps x-amz-meta-* response headers → Metadata.*
  CID=$(echo "$HEAD" | jq -r '.Metadata.cid // ""')
  if [[ -n "$CID" ]]; then
    ok "HeadObject — x-amz-meta-cid present (${CID:0:16}…)"
  else
    fail "HeadObject — x-amz-meta-cid missing from response Metadata" "$HEAD"
  fi
else
  fail "HeadObject — request failed" "$HEAD"
fi

# ─────────────────────────────────────────────────────────────────────────────
# PR 683 — DeleteObject returns 403
# ─────────────────────────────────────────────────────────────────────────────

section "PR 683 — DeleteObject returns 403 AccessDenied"

DELETE_OUT=$(S3 delete-object \
    --bucket "$TEST_BUCKET" \
    --key "$OBJECT_KEY" 2>&1) && DELETE_EXIT=0 || DELETE_EXIT=$?

if [[ $DELETE_EXIT -ne 0 ]]; then
  if echo "$DELETE_OUT" | grep -qi "AccessDenied\|403"; then
    ok "DeleteObject — returns 403 AccessDenied"
  else
    fail "DeleteObject — expected 403, got a different error" "$DELETE_OUT"
  fi
else
  fail "DeleteObject — expected 403 but request succeeded" "$DELETE_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# PR 695 — Multipart Upload (composite ETag)
# ─────────────────────────────────────────────────────────────────────────────

section "PR 695 — Multipart upload composite ETag"

MPU_KEY="smoke-mpu-${TS}.bin"
PART1="${WORK}/part1.bin"
PART2="${WORK}/part2.bin"

# Two 1 MB parts — quick to upload while still exercising multipart code path
dd if=/dev/urandom of="$PART1" bs=1048576 count=1 2>/dev/null
dd if=/dev/urandom of="$PART2" bs=1048576 count=1 2>/dev/null

if MPU=$(S3 create-multipart-upload \
    --bucket "$TEST_BUCKET" \
    --key "$MPU_KEY" 2>&1); then

  UPLOAD_ID=$(echo "$MPU" | jq -r '.UploadId')
  ok "Multipart — create-multipart-upload"

  UP1_OK=true; UP2_OK=true
  UP1=$(S3 upload-part \
      --bucket "$TEST_BUCKET" --key "$MPU_KEY" \
      --upload-id "$UPLOAD_ID" --part-number 1 \
      --body "$PART1" 2>&1) || UP1_OK=false

  UP2=$(S3 upload-part \
      --bucket "$TEST_BUCKET" --key "$MPU_KEY" \
      --upload-id "$UPLOAD_ID" --part-number 2 \
      --body "$PART2" 2>&1) || UP2_OK=false

  if ! $UP1_OK || ! $UP2_OK; then
    fail "Multipart — upload-part" "part1: ${UP1:-failed}  part2: ${UP2:-failed}"
  else
    ETAG1=$(echo "$UP1" | jq -r '.ETag')
    ETAG2=$(echo "$UP2" | jq -r '.ETag')
    ok "Multipart — upload-part 1 (${ETAG1})"
    ok "Multipart — upload-part 2 (${ETAG2})"

    PARTS_JSON=$(jq -n \
        --arg e1 "$ETAG1" --arg e2 "$ETAG2" \
        '{Parts:[{PartNumber:1,ETag:$e1},{PartNumber:2,ETag:$e2}]}')

    if COMPLETE=$(S3 complete-multipart-upload \
        --bucket "$TEST_BUCKET" \
        --key "$MPU_KEY" \
        --upload-id "$UPLOAD_ID" \
        --multipart-upload "$PARTS_JSON" 2>&1); then

      # Composite ETag format: "<md5hex>-<part-count>"  e.g. "abc123...-2"
      COMPOSITE=$(echo "$COMPLETE" | jq -r '.ETag // ""' | tr -d '"')
      if [[ "$COMPOSITE" =~ ^[0-9a-f]{32}-[0-9]+$ ]]; then
        ok "Multipart — composite ETag format correct (${COMPOSITE})"
      else
        fail "Multipart — ETag not in composite format" "got: '${COMPOSITE}'"
      fi
    else
      fail "Multipart — complete-multipart-upload" "$COMPLETE"
    fi
  fi
else
  fail "Multipart — create-multipart-upload" "$MPU"
fi

# ─────────────────────────────────────────────────────────────────────────────
# PR 695 — rclone check (MD5 checksum verification)
# ─────────────────────────────────────────────────────────────────────────────

section "PR 695 — rclone check (MD5 checksum verification)"

if ! $HAVE_RCLONE; then
  skip "rclone remote '${RCLONE_REMOTE}' not configured"
else
  RC_DIR="${WORK}/rclone-check"
  mkdir -p "$RC_DIR"
  RC_FILE="smoke-chk-${TS}.txt"
  printf 'rclone checksum smoke test' >"${RC_DIR}/${RC_FILE}"

  # Upload via AWS CLI so the server stores the MD5 ETag
  S3 put-object \
      --bucket "$TEST_BUCKET" \
      --key "$RC_FILE" \
      --body "${RC_DIR}/${RC_FILE}" \
      --content-type "text/plain" >/dev/null 2>&1

  # rclone check compares local MD5s against the server ETag.
  # Before PR 695 this failed because the server returned the CID as ETag.
  # After PR 695 the server returns the real MD5 so the check passes.
  RCLONE_OUT=$(rclone check \
      "$RC_DIR" \
      "${RCLONE_REMOTE}:${TEST_BUCKET}" \
      --include "$RC_FILE" 2>&1) && RC_EXIT=0 || RC_EXIT=$?

  if [[ $RC_EXIT -eq 0 ]]; then
    ok "rclone check — passes without --ignore-checksum"
  else
    fail "rclone check — MD5 verification failed" "$RCLONE_OUT"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────

printf "\n${BOLD}══════════════════════════════════${RESET}\n"
if [[ $FAIL -gt 0 ]]; then
  printf "  ${GREEN}%d passed${RESET}   ${RED}%d failed${RESET}\n" "$PASS" "$FAIL"
else
  printf "  ${GREEN}%d passed${RESET}   %d failed\n" "$PASS" "$FAIL"
fi
printf "${BOLD}══════════════════════════════════${RESET}\n\n"

[[ $FAIL -eq 0 ]]
