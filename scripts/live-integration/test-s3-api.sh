#!/usr/bin/env bash
#
# test-s3-api.sh — Integration tests for the Auto Drive S3 API.
#
# Black-box tests against a live, deployed S3 endpoint.  Requires a valid
# API key; not hermetic.  Intended to be run by developers and operators
# against staging or production, not in CI.
#
# Direct API coverage (via AWS CLI):
#   PR 683  DeleteObject returns 403 AccessDenied (storage is immutable)
#   PR 684  Bucket support — first path segment of S3 key is the bucket name
#   PR 695  MD5 ETags — PutObject, HeadObject, x-amz-meta-cid, multipart
#   PR 696  ListObjectsV2 — basic listing, prefix filter, delimiter folding
#   PR 717  ListObjectsV2 returns MD5 ETags (matching HeadObject), not CIDs
#
# Extended coverage:
#   - HeadObject — ContentLength, LastModified, Content-Type round-trip,
#                  default Content-Type when PUT omits, user-metadata
#                  silently dropped (negative test)
#   - ListBuckets — CreationDate is ISO-8601
#   - GetObject Range — prefix (0-N), middle, open-ended (N-), suffix (-N),
#                       invalid (start > length)
#   - GetObject / HeadObject 404 paths for missing keys
#   - ListObjectsV2 — flat (no delimiter), pagination drain (MaxKeys + token),
#                     MaxKeys clamping [1,1000], KeyCount, empty result,
#                     exact-key prefix, EncodingType=url
#   - Multipart — 2-part integrity + composite ETag locally recomputed,
#                 3-part out-of-order completion, UploadPart unknown UploadId
#   - Zero-byte object — ETag must equal md5("")
#   - Overwrite same key — latest-write wins, ETag reflects new content
#   - Special-character keys — space + unicode round-trip
#   - AbortMultipartUpload — informational probe
#   - Unsupported operations probes — HeadBucket, GetBucketLocation,
#                                     CopyObject, DeleteObjects, ListParts,
#                                     ListMultipartUploads
#
# Data hygiene: storage on Auto Drive is immutable and content-addressed.
# All upload content is deterministic (no timestamps or randomness in bodies),
# so repeat runs hash to identical CIDs and consume no new DSN storage.
# Multipart parts are sized to the minimum that exercises the code path —
# 16 KiB rather than 1 MiB — since the backend does not enforce S3's 5 MiB
# per-part minimum.
#
# For rclone client interop, see the companion script
# scripts/live-integration/test-s3-rclone.sh.
#
# Prerequisites:
#   aws     AWS CLI v2          https://aws.amazon.com/cli/
#   jq      JSON processor      https://stedolan.github.io/jq/
#
# Usage:
#   AUTO_DRIVE_API_KEY=<api_key> ./scripts/live-integration/test-s3-api.sh
#
# Optional overrides:
#   AUTO_DRIVE_ENDPOINT   default: https://public.auto-drive.autonomys.xyz/s3
#   TEST_BUCKET           default: s3-smoke-test

set -uo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
  BOLD='\033[1m'   DIM='\033[2m'      RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' BOLD='' DIM='' RESET=''
fi

PASS=0; FAIL=0; INFO=0

ok()      { printf "  ${GREEN}✓${RESET}  %s\n" "$1"; PASS=$((PASS+1)); }
fail()    { printf "  ${RED}✗${RESET}  %s\n" "$1"
            [ -n "${2:-}" ] && printf "      ${DIM}%s${RESET}\n" "$2"
            FAIL=$((FAIL+1)); }
info()    { printf "  ${YELLOW}ℹ${RESET}  %s\n" "$1"
            [ -n "${2:-}" ] && printf "      ${DIM}%s${RESET}\n" "$2"
            INFO=$((INFO+1)); }
section() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

# Portable md5 / sha256 helpers — macOS ships `md5 -q` / `shasum -a 256`,
# Linux ships `md5sum` / `sha256sum`.
md5_of() {
  if command -v md5 >/dev/null 2>&1; then md5 -q "$1"
  else md5sum "$1" | awk '{print $1}'; fi
}
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# ── Configuration ─────────────────────────────────────────────────────────────

ENDPOINT="${AUTO_DRIVE_ENDPOINT:-https://public.auto-drive.autonomys.xyz/s3}"
API_KEY="${AUTO_DRIVE_API_KEY:-}"
TEST_BUCKET="${TEST_BUCKET:-s3-smoke-test}"

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
# Deterministic content (no epoch in the body) so subsequent runs hit identical
# CIDs on the content-addressed DSN and consume no new storage.  The epoch
# stays in the *key* so concurrent or sequential runs do not collide.
OBJECT_CONTENT="Auto Drive S3 integration test fixture body"
OBJECT_FILE="${WORK}/upload.txt"
printf '%s' "$OBJECT_CONTENT" >"$OBJECT_FILE"

EXPECTED_MD5=$(md5_of "$OBJECT_FILE")

# ── Banner ────────────────────────────────────────────────────────────────────

printf "\n${BOLD}Auto Drive S3 API integration tests${RESET}\n"
printf "Endpoint  %s\n" "$ENDPOINT"
printf "Bucket    %s\n" "$TEST_BUCKET"

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

  # CreationDate must be a valid ISO-8601 timestamp.  The handler emits
  # b.creationDate.toISOString() (millisecond precision + 'Z'), but values
  # observed in the wild also include microsecond precision and explicit
  # ±HH:MM offsets — accept either fractional-second precision and any of
  # the three timezone forms ('Z', '±HH:MM', or absent).  Use a regex to
  # stay portable across macOS BSD date and Linux GNU date.
  CDATE=$(echo "$LIST" | jq -r --arg b "$TEST_BUCKET" \
      '.Buckets[] | select(.Name == $b) | .CreationDate // ""')
  if [[ "$CDATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})?$ ]]; then
    ok "ListBuckets — '${TEST_BUCKET}' CreationDate is ISO-8601 (${CDATE})"
  else
    fail "ListBuckets — CreationDate missing or not ISO-8601" "got: '${CDATE}'"
  fi
else
  fail "ListBuckets — request failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Error paths — 404s for missing keys
# ─────────────────────────────────────────────────────────────────────────────

section "Error paths — missing keys return 404"

MISSING_KEY="smoke-missing-${TS}.nope"

# HeadObject on a missing key must return 404 NotFound (not 200, not 500).
HEAD_OUT=$(S3 head-object \
    --bucket "$TEST_BUCKET" \
    --key "$MISSING_KEY" 2>&1) && HEAD_EXIT=0 || HEAD_EXIT=$?
if [[ $HEAD_EXIT -ne 0 ]]; then
  if echo "$HEAD_OUT" | grep -qi "404\|Not Found\|NotFound\|NoSuchKey"; then
    ok "HeadObject — missing key returns 404"
  else
    fail "HeadObject — missing key error wasn't 404" "$HEAD_OUT"
  fi
else
  fail "HeadObject — expected 404 but got 200" "$HEAD_OUT"
fi

# GetObject on a missing key must return 404 / NoSuchKey.
GET_OUT=$(S3 get-object \
    --bucket "$TEST_BUCKET" \
    --key "$MISSING_KEY" \
    "${WORK}/missing.bin" 2>&1) && GET_EXIT=0 || GET_EXIT=$?
if [[ $GET_EXIT -ne 0 ]]; then
  if echo "$GET_OUT" | grep -qi "404\|NoSuchKey\|Not Found"; then
    ok "GetObject — missing key returns 404"
  else
    fail "GetObject — missing key error wasn't 404" "$GET_OUT"
  fi
else
  fail "GetObject — expected 404 but request succeeded" "$GET_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# GetObject byte-range
# ─────────────────────────────────────────────────────────────────────────────

section "GetObject — byte-range support"

RANGE_FILE="${WORK}/range.bin"
RANGE_END=9   # bytes 0..9 inclusive → 10 bytes
EXPECTED_RANGE=$(head -c $((RANGE_END + 1)) "$OBJECT_FILE")

if S3 get-object \
    --bucket "$TEST_BUCKET" \
    --key "$OBJECT_KEY" \
    --range "bytes=0-${RANGE_END}" \
    "$RANGE_FILE" >/dev/null 2>&1; then
  ACTUAL_RANGE=$(cat "$RANGE_FILE")
  ACTUAL_LEN=$(wc -c <"$RANGE_FILE" | tr -d ' ')
  EXPECTED_LEN=$((RANGE_END + 1))
  if [[ "$ACTUAL_LEN" == "$EXPECTED_LEN" && "$ACTUAL_RANGE" == "$EXPECTED_RANGE" ]]; then
    ok "GetObject Range — prefix bytes=0-${RANGE_END} returns ${EXPECTED_LEN} matching bytes"
  else
    fail "GetObject Range — prefix content/length mismatch" \
      "want '${EXPECTED_RANGE}' (${EXPECTED_LEN}B), got '${ACTUAL_RANGE}' (${ACTUAL_LEN}B)"
  fi
else
  fail "GetObject Range — prefix request failed"
fi

# Middle range — bytes=5-15 (11 bytes from the middle of the object).
MID_FILE="${WORK}/range-mid.bin"
MID_EXPECTED=$(tail -c +6 "$OBJECT_FILE" | head -c 11)
if S3 get-object --bucket "$TEST_BUCKET" --key "$OBJECT_KEY" \
    --range "bytes=5-15" "$MID_FILE" >/dev/null 2>&1; then
  MID_LEN=$(wc -c <"$MID_FILE" | tr -d ' ')
  if [[ "$MID_LEN" == "11" && "$(cat "$MID_FILE")" == "$MID_EXPECTED" ]]; then
    ok "GetObject Range — middle bytes=5-15 returns 11 matching bytes"
  else
    fail "GetObject Range — middle content mismatch" \
      "want '${MID_EXPECTED}' got '$(cat "$MID_FILE")' (${MID_LEN}B)"
  fi
else
  fail "GetObject Range — middle request failed"
fi

# Open-ended range — bytes=5- (offset 5 to end of object).
OPEN_FILE="${WORK}/range-open.bin"
OPEN_EXPECTED=$(tail -c +6 "$OBJECT_FILE")
OPEN_EXPECTED_LEN=$(printf '%s' "$OPEN_EXPECTED" | wc -c | tr -d ' ')
if S3 get-object --bucket "$TEST_BUCKET" --key "$OBJECT_KEY" \
    --range "bytes=5-" "$OPEN_FILE" >/dev/null 2>&1; then
  OPEN_LEN=$(wc -c <"$OPEN_FILE" | tr -d ' ')
  if [[ "$OPEN_LEN" == "$OPEN_EXPECTED_LEN" && "$(cat "$OPEN_FILE")" == "$OPEN_EXPECTED" ]]; then
    ok "GetObject Range — open-ended bytes=5- returns ${OPEN_EXPECTED_LEN} matching bytes"
  else
    fail "GetObject Range — open-ended content/length mismatch" \
      "want ${OPEN_EXPECTED_LEN}B got ${OPEN_LEN}B"
  fi
else
  fail "GetObject Range — open-ended request failed"
fi

# Suffix range — bytes=-10 (last 10 bytes).
# Suffix syntax is optional per RFC 7233 §2.1; servers may legitimately
# decline to support it.  Treat a successful request that returns the wrong
# content (typically: the server ignored the range and returned a prefix or
# the full body) as informational, not a failure.
SUF_FILE="${WORK}/range-suffix.bin"
SUF_EXPECTED=$(tail -c 10 "$OBJECT_FILE")
if S3 get-object --bucket "$TEST_BUCKET" --key "$OBJECT_KEY" \
    --range "bytes=-10" "$SUF_FILE" >/dev/null 2>&1; then
  SUF_LEN=$(wc -c <"$SUF_FILE" | tr -d ' ')
  if [[ "$SUF_LEN" == "10" && "$(cat "$SUF_FILE")" == "$SUF_EXPECTED" ]]; then
    ok "GetObject Range — suffix bytes=-10 returns last 10 matching bytes"
  else
    info "GetObject Range — suffix bytes=-N not honoured (server returned different content)" \
      "want '${SUF_EXPECTED}' got '$(cat "$SUF_FILE" | head -c 30)' (${SUF_LEN}B)"
  fi
else
  info "GetObject Range — suffix bytes=-N rejected by server"
fi

# Invalid range — start beyond content-length should return 416 Range Not
# Satisfiable.  Some clients (and some servers) instead return 200 with the
# whole body; report whichever happens.
OBJECT_LEN=$(wc -c <"$OBJECT_FILE" | tr -d ' ')
BAD_START=$((OBJECT_LEN + 100))
INVALID_OUT=$(S3 get-object --bucket "$TEST_BUCKET" --key "$OBJECT_KEY" \
    --range "bytes=${BAD_START}-$((BAD_START + 10))" \
    "${WORK}/range-invalid.bin" 2>&1) && INVALID_EXIT=0 || INVALID_EXIT=$?
if [[ $INVALID_EXIT -ne 0 ]]; then
  if echo "$INVALID_OUT" | grep -qi "416\|InvalidRange\|not satisfiable"; then
    ok "GetObject Range — invalid range (start > length) returns 416"
  else
    info "GetObject Range — invalid range returned a non-416 error" \
      "$(echo "$INVALID_OUT" | head -1)"
  fi
else
  info "GetObject Range — invalid range did not return an error (lenient handling)"
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

  # x-amz-meta-cid: AWS SDK maps x-amz-meta-* response headers → Metadata.*.
  # The CLI sometimes preserves the source-header casing (e.g. 'Cid') and
  # sometimes lowercases it; normalise keys before the lookup so the
  # assertion does not depend on which form we get back.
  CID=$(echo "$HEAD" | jq -r \
      '(.Metadata // {} | with_entries(.key |= ascii_downcase)) | .cid // ""')
  if [[ -n "$CID" ]]; then
    ok "HeadObject — x-amz-meta-cid present (${CID:0:16}…)"
  else
    fail "HeadObject — x-amz-meta-cid missing from response Metadata" "$HEAD"
  fi
else
  fail "HeadObject — request failed" "$HEAD"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Header round-trips — Content-Type, ContentLength, LastModified, metadata
# ─────────────────────────────────────────────────────────────────────────────

section "HeadObject header round-trips"

# ContentLength: HEAD on the non-empty seed object must report the real size.
HEAD=$(S3 head-object --bucket "$TEST_BUCKET" --key "$OBJECT_KEY" 2>&1)
SEED_LEN=$(wc -c <"$OBJECT_FILE" | tr -d ' ')
HEAD_LEN=$(echo "$HEAD" | jq -r '.ContentLength // 0')
if [[ "$HEAD_LEN" == "$SEED_LEN" ]]; then
  ok "HeadObject — ContentLength=${HEAD_LEN} matches file size"
else
  fail "HeadObject — ContentLength wrong" "head=${HEAD_LEN} file=${SEED_LEN}"
fi

# LastModified: must be present and ISO-8601 (jq emits it as a string).
LAST_MOD=$(echo "$HEAD" | jq -r '.LastModified // ""')
if [[ -n "$LAST_MOD" ]]; then
  ok "HeadObject — LastModified present (${LAST_MOD})"
else
  fail "HeadObject — LastModified missing from response"
fi

# Content-Type round-trip: the seed PUT set --content-type text/plain.
# HEAD should echo it back.  (handleDownloadResponseHeaders / metadata.)
HEAD_CT=$(echo "$HEAD" | jq -r '.ContentType // ""')
if [[ "$HEAD_CT" == "text/plain" ]]; then
  ok "HeadObject — ContentType round-trips ('text/plain')"
else
  info "HeadObject — ContentType is '${HEAD_CT}' (PUT set 'text/plain')"
fi

# Content-Type when PUT omits the header — document the default behaviour.
NOCT_KEY="smoke-noct-${TS}.bin"
NOCT_FILE="${WORK}/noct.bin"
printf 'no content-type set on PUT' >"$NOCT_FILE"
if S3 put-object --bucket "$TEST_BUCKET" --key "$NOCT_KEY" \
    --body "$NOCT_FILE" >/dev/null 2>&1; then
  if NOCT_HEAD=$(S3 head-object --bucket "$TEST_BUCKET" --key "$NOCT_KEY" 2>&1); then
    NOCT_CT=$(echo "$NOCT_HEAD" | jq -r '.ContentType // "<absent>"')
    info "HeadObject — default ContentType when PUT omits is '${NOCT_CT}'"
  fi
fi

# User-defined metadata (x-amz-meta-*) — the controller does NOT forward
# arbitrary request headers to the use case (apps/backend/.../s3.ts:389-395
# only passes Body, ContentType, UploadOptions).  Document that contract:
# custom metadata sent on PUT must NOT come back on HEAD.  Only the
# server-set 'cid' should be present in Metadata.
META_KEY="smoke-meta-${TS}.txt"
META_FILE="${WORK}/meta.txt"
printf 'user-metadata behaviour probe' >"$META_FILE"
if S3 put-object --bucket "$TEST_BUCKET" --key "$META_KEY" \
    --body "$META_FILE" \
    --metadata 'mykey=myvalue,another=value2' >/dev/null 2>&1; then
  if META_HEAD=$(S3 head-object --bucket "$TEST_BUCKET" --key "$META_KEY" 2>&1); then
    # Normalise Metadata keys to lowercase before lookup (see PR 695 section
    # above for context).  Looking up the canonical form makes the assertion
    # case-insensitive in both directions: catches a 'Mykey' echo as well as
    # a 'mykey' one.
    META_NORM=$(echo "$META_HEAD" | jq \
        '(.Metadata // {} | with_entries(.key |= ascii_downcase))')
    HAS_MYKEY=$(echo "$META_NORM" | jq -r '.mykey // ""')
    HAS_ANOTHER=$(echo "$META_NORM" | jq -r '.another // ""')
    HAS_CID=$(echo "$META_NORM" | jq -r '.cid // ""')
    if [[ -z "$HAS_MYKEY" && -z "$HAS_ANOTHER" && -n "$HAS_CID" ]]; then
      ok "HeadObject — user metadata silently dropped; only x-amz-meta-cid is set"
    elif [[ -n "$HAS_MYKEY" || -n "$HAS_ANOTHER" ]]; then
      info "HeadObject — user metadata round-trips (contract may have changed)" \
        "mykey='${HAS_MYKEY}' another='${HAS_ANOTHER}'"
    else
      fail "HeadObject — x-amz-meta-cid missing too" "$META_HEAD"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Zero-byte object — ETag must equal md5("")
# ─────────────────────────────────────────────────────────────────────────────

section "Zero-byte object"

EMPTY_KEY="smoke-empty-${TS}.bin"
EMPTY_FILE="${WORK}/empty.bin"
: >"$EMPTY_FILE"
EMPTY_MD5="d41d8cd98f00b204e9800998ecf8427e"   # md5 of zero bytes, by definition

if S3 put-object \
    --bucket "$TEST_BUCKET" \
    --key "$EMPTY_KEY" \
    --body "$EMPTY_FILE" >/dev/null 2>&1; then
  ok "PutObject — zero-byte upload accepted"
  if HEAD=$(S3 head-object --bucket "$TEST_BUCKET" --key "$EMPTY_KEY" 2>&1); then
    SIZE=$(echo "$HEAD" | jq -r '.ContentLength')
    ZE_ETAG=$(echo "$HEAD" | jq -r '.ETag // ""' | tr -d '"')
    if [[ "$SIZE" == "0" ]]; then ok "HeadObject — zero-byte ContentLength=0"
    else fail "HeadObject — zero-byte ContentLength wrong" "got: ${SIZE}"; fi
    if [[ "$ZE_ETAG" == "$EMPTY_MD5" ]]; then
      ok "HeadObject — zero-byte ETag = md5(\"\")"
    else
      fail "HeadObject — zero-byte ETag wrong" "want ${EMPTY_MD5}, got ${ZE_ETAG}"
    fi
  else
    fail "HeadObject — zero-byte request failed" "$HEAD"
  fi
else
  info "PutObject — zero-byte upload rejected (may be intentional)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Overwrite same key — latest write wins, ETag reflects new content
# ─────────────────────────────────────────────────────────────────────────────

section "Overwrite same key"

OVR_KEY="smoke-overwrite-${TS}.txt"
OVR_FILE_A="${WORK}/ovr-a.txt"
OVR_FILE_B="${WORK}/ovr-b.txt"
printf 'overwrite test A — first write' >"$OVR_FILE_A"
printf 'overwrite test B — second write, distinct content' >"$OVR_FILE_B"
OVR_MD5_A=$(md5_of "$OVR_FILE_A")
OVR_MD5_B=$(md5_of "$OVR_FILE_B")

if S3 put-object --bucket "$TEST_BUCKET" --key "$OVR_KEY" \
    --body "$OVR_FILE_A" >/dev/null 2>&1 \
&& S3 put-object --bucket "$TEST_BUCKET" --key "$OVR_KEY" \
    --body "$OVR_FILE_B" >/dev/null 2>&1; then
  if HEAD=$(S3 head-object --bucket "$TEST_BUCKET" --key "$OVR_KEY" 2>&1); then
    OVR_ETAG=$(echo "$HEAD" | jq -r '.ETag // ""' | tr -d '"')
    if [[ "$OVR_ETAG" == "$OVR_MD5_B" ]]; then
      ok "Overwrite — HEAD ETag matches latest write (${OVR_MD5_B})"
    elif [[ "$OVR_ETAG" == "$OVR_MD5_A" ]]; then
      fail "Overwrite — HEAD ETag matches first write, not latest" \
        "first=${OVR_MD5_A}  latest=${OVR_MD5_B}  head=${OVR_ETAG}"
    else
      fail "Overwrite — HEAD ETag matches neither write" \
        "first=${OVR_MD5_A}  latest=${OVR_MD5_B}  head=${OVR_ETAG}"
    fi
    # Verify GetObject returns the latest body, not the first.
    OVR_BACK="${WORK}/ovr-back.txt"
    if S3 get-object --bucket "$TEST_BUCKET" --key "$OVR_KEY" \
        "$OVR_BACK" >/dev/null 2>&1; then
      if cmp -s "$OVR_FILE_B" "$OVR_BACK"; then
        ok "Overwrite — GetObject returns the latest body"
      else
        fail "Overwrite — GetObject did not return the latest body"
      fi
    fi
  else
    fail "Overwrite — HeadObject failed" "$HEAD"
  fi
else
  info "Overwrite — second PutObject rejected; backend may forbid overwrites"
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
# PR 695 — Multipart Upload (composite ETag, integrity round-trip)
# ─────────────────────────────────────────────────────────────────────────────

section "PR 695 — Multipart upload"

MPU_KEY="smoke-mpu-${TS}.bin"
PART1="${WORK}/part1.bin"
PART2="${WORK}/part2.bin"
CONCAT="${WORK}/concat.bin"

# Two 16 KiB parts of distinct deterministic content.
#
# Why so small? The S3 spec mandates non-last parts ≥5 MiB, but our backend's
# uploadPart enforces no minimum (verified at any size).  We use the smallest
# part size that still meaningfully exercises the multipart code path so the
# script does not bloat DSN storage on every run.
#
# Why deterministic? Auto Drive is content-addressed — identical bytes hash to
# the same CID, so deterministic content lets the DSN deduplicate after the
# first run.  Distinct patterns per part also let us verify part ordering.
PART_SIZE_BYTES=16384
head -c "$PART_SIZE_BYTES" /dev/zero | tr '\0' 'A' >"$PART1"
head -c "$PART_SIZE_BYTES" /dev/zero | tr '\0' 'B' >"$PART2"
cat "$PART1" "$PART2" >"$CONCAT"

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

    # Per-part ETag = MD5 of part body.
    PART1_MD5=$(md5_of "$PART1")
    PART2_MD5=$(md5_of "$PART2")
    if [[ "${ETAG1//\"/}" == "$PART1_MD5" && "${ETAG2//\"/}" == "$PART2_MD5" ]]; then
      ok "Multipart — part ETags match per-part MD5s"
    else
      fail "Multipart — part ETags don't match per-part MD5s" \
        "p1: etag=${ETAG1//\"/} md5=${PART1_MD5}  p2: etag=${ETAG2//\"/} md5=${PART2_MD5}"
    fi

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

      # Recompute the expected composite locally: md5 of binary concatenation
      # of each part's raw MD5 bytes, suffixed with "-<part-count>".
      MD5_CONCAT="${WORK}/md5-concat.bin"
      printf '%s%s' "$PART1_MD5" "$PART2_MD5" | xxd -r -p >"$MD5_CONCAT"
      EXPECTED_COMPOSITE="$(md5_of "$MD5_CONCAT")-2"
      if [[ "$COMPOSITE" == "$EXPECTED_COMPOSITE" ]]; then
        ok "Multipart — composite ETag value matches locally-computed expectation"
      else
        fail "Multipart — composite ETag value wrong" \
          "server=${COMPOSITE}  expected=${EXPECTED_COMPOSITE}"
      fi

      # Download the assembled object and verify byte-for-byte integrity.
      MPU_BACK="${WORK}/mpu-back.bin"
      if S3 get-object --bucket "$TEST_BUCKET" --key "$MPU_KEY" \
          "$MPU_BACK" >/dev/null 2>&1; then
        LOCAL_SHA=$(sha256_of "$CONCAT")
        REMOTE_SHA=$(sha256_of "$MPU_BACK")
        LOCAL_LEN=$(wc -c <"$CONCAT" | tr -d ' ')
        REMOTE_LEN=$(wc -c <"$MPU_BACK" | tr -d ' ')
        if [[ "$LOCAL_SHA" == "$REMOTE_SHA" && "$LOCAL_LEN" == "$REMOTE_LEN" ]]; then
          ok "Multipart — GetObject returns assembled bytes (${LOCAL_LEN} B, sha256 match)"
        else
          fail "Multipart — assembled object differs from concatenated parts" \
            "local=${LOCAL_LEN}B/${LOCAL_SHA}  remote=${REMOTE_LEN}B/${REMOTE_SHA}"
        fi
      else
        fail "Multipart — GetObject on assembled object failed"
      fi
    else
      fail "Multipart — complete-multipart-upload" "$COMPLETE"
    fi
  fi
else
  fail "Multipart — create-multipart-upload" "$MPU"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Multipart — 3 parts uploaded out of order, completed out of order
#
# CompleteMultipartUpload must sort by PartNumber regardless of the order
# parts are listed.  We upload as [2, 1, 3] and complete as [3, 1, 2]; the
# assembled body must still be AAA…BBB…CCC… in PartNumber order.
# ─────────────────────────────────────────────────────────────────────────────

MPU3_KEY="smoke-mpu3-${TS}.bin"
P3A="${WORK}/mpu3-a.bin"; P3B="${WORK}/mpu3-b.bin"; P3C="${WORK}/mpu3-c.bin"
head -c "$PART_SIZE_BYTES" /dev/zero | tr '\0' 'A' >"$P3A"
head -c "$PART_SIZE_BYTES" /dev/zero | tr '\0' 'B' >"$P3B"
head -c "$PART_SIZE_BYTES" /dev/zero | tr '\0' 'C' >"$P3C"
MPU3_CONCAT="${WORK}/mpu3-concat.bin"
cat "$P3A" "$P3B" "$P3C" >"$MPU3_CONCAT"

if MPU3=$(S3 create-multipart-upload \
    --bucket "$TEST_BUCKET" --key "$MPU3_KEY" 2>&1); then
  MPU3_ID=$(echo "$MPU3" | jq -r '.UploadId')

  # Upload in order [2, 1, 3] — server stores by PartNumber, not arrival order.
  E3B=$(S3 upload-part --bucket "$TEST_BUCKET" --key "$MPU3_KEY" \
      --upload-id "$MPU3_ID" --part-number 2 --body "$P3B" 2>/dev/null | jq -r '.ETag')
  E3A=$(S3 upload-part --bucket "$TEST_BUCKET" --key "$MPU3_KEY" \
      --upload-id "$MPU3_ID" --part-number 1 --body "$P3A" 2>/dev/null | jq -r '.ETag')
  E3C=$(S3 upload-part --bucket "$TEST_BUCKET" --key "$MPU3_KEY" \
      --upload-id "$MPU3_ID" --part-number 3 --body "$P3C" 2>/dev/null | jq -r '.ETag')

  # Complete with parts listed in [3, 1, 2] order; server must sort.
  PARTS3_JSON=$(jq -n \
      --arg e1 "$E3A" --arg e2 "$E3B" --arg e3 "$E3C" \
      '{Parts:[{PartNumber:3,ETag:$e3},{PartNumber:1,ETag:$e1},{PartNumber:2,ETag:$e2}]}')

  if S3 complete-multipart-upload --bucket "$TEST_BUCKET" --key "$MPU3_KEY" \
      --upload-id "$MPU3_ID" --multipart-upload "$PARTS3_JSON" >/dev/null 2>&1; then
    ok "Multipart 3-part — completed with parts listed out of order"

    # Download and verify the assembled body is AAA…BBB…CCC… by PartNumber.
    MPU3_BACK="${WORK}/mpu3-back.bin"
    if S3 get-object --bucket "$TEST_BUCKET" --key "$MPU3_KEY" \
        "$MPU3_BACK" >/dev/null 2>&1; then
      LSHA=$(sha256_of "$MPU3_CONCAT")
      RSHA=$(sha256_of "$MPU3_BACK")
      if [[ "$LSHA" == "$RSHA" ]]; then
        ok "Multipart 3-part — assembled bytes match A→B→C order despite [2,1,3]/[3,1,2] arrival"
      else
        fail "Multipart 3-part — assembled bytes do not match expected order" \
          "local=${LSHA} remote=${RSHA}"
      fi
    else
      fail "Multipart 3-part — GetObject on assembled object failed"
    fi
  else
    fail "Multipart 3-part — complete-multipart-upload failed"
  fi
else
  fail "Multipart 3-part — create-multipart-upload failed"
fi

# UploadPart with an unknown UploadId — negative test, must not succeed.
BAD_UPLOAD_ID="00000000-0000-0000-0000-000000000000"
BAD_UP_OUT=$(S3 upload-part \
    --bucket "$TEST_BUCKET" --key "smoke-mpu-bad-${TS}.bin" \
    --upload-id "$BAD_UPLOAD_ID" --part-number 1 \
    --body "$OBJECT_FILE" 2>&1) && BAD_UP_EXIT=0 || BAD_UP_EXIT=$?
if [[ $BAD_UP_EXIT -ne 0 ]]; then
  ok "UploadPart — unknown UploadId is rejected"
else
  fail "UploadPart — unknown UploadId accepted (should have failed)" "$BAD_UP_OUT"
fi

# AbortMultipartUpload — probe; backend may not support it.  Informational only.
if MPU_ABORT=$(S3 create-multipart-upload \
    --bucket "$TEST_BUCKET" \
    --key "smoke-mpu-abort-${TS}.bin" 2>&1); then
  ABORT_ID=$(echo "$MPU_ABORT" | jq -r '.UploadId')
  ABORT_OUT=$(S3 abort-multipart-upload \
      --bucket "$TEST_BUCKET" \
      --key "smoke-mpu-abort-${TS}.bin" \
      --upload-id "$ABORT_ID" 2>&1) && ABORT_EXIT=0 || ABORT_EXIT=$?
  if [[ $ABORT_EXIT -eq 0 ]]; then
    ok "AbortMultipartUpload — accepted"
  else
    info "AbortMultipartUpload — not supported (informational)" "$ABORT_OUT"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# PR 696 — ListObjectsV2 (basic listing, prefix filter, delimiter folding)
# ─────────────────────────────────────────────────────────────────────────────

section "PR 696 — ListObjectsV2"

# Seed a small key tree so delimiter folding has something to fold:
#   ${OBJECT_KEY}             ← already uploaded above
#   smoke-tree-${TS}/a.txt
#   smoke-tree-${TS}/b.txt
#   smoke-tree-${TS}/sub/c.txt
TREE_PREFIX="smoke-tree-${TS}"
TREE_FILE="${WORK}/tree.txt"
printf 'tree' >"$TREE_FILE"
for k in "${TREE_PREFIX}/a.txt" "${TREE_PREFIX}/b.txt" "${TREE_PREFIX}/sub/c.txt"; do
  S3 put-object --bucket "$TEST_BUCKET" --key "$k" --body "$TREE_FILE" \
      --content-type "text/plain" >/dev/null 2>&1 \
    || fail "ListObjectsV2 setup — could not seed ${k}"
done

# These assertions inspect a single ListObjectsV2 response, so all use
# --no-paginate.  Without it the AWS CLI auto-paginates and botocore's
# paginator returns only the aggregated result keys (Contents, CommonPrefixes)
# — it drops the per-response fields KeyCount, Name, Prefix, MaxKeys,
# IsTruncated, NextContinuationToken and EncodingType from the merged output,
# which would make any assertion on those silently read a missing value.

# Basic listing — the uploaded smoke object must appear in Contents
if LIST=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" --prefix "smoke-" \
    --no-paginate 2>&1); then
  if echo "$LIST" | jq -e --arg k "$OBJECT_KEY" \
      '.Contents[]?.Key | select(. == $k)' >/dev/null 2>&1; then
    ok "ListObjectsV2 — basic listing returns uploaded key"
  else
    fail "ListObjectsV2 — uploaded key not in Contents" \
      "$(echo "$LIST" | jq -r '[.Contents[]?.Key] | join(", ")' 2>/dev/null)"
  fi
else
  fail "ListObjectsV2 — request failed" "$LIST"
fi

# Prefix filter — only the tree keys should come back
if LIST=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
    --prefix "${TREE_PREFIX}/" --no-paginate 2>&1); then
  COUNT=$(echo "$LIST" | jq '[.Contents[]?.Key] | length' 2>/dev/null)
  if [[ "$COUNT" == "3" ]]; then
    ok "ListObjectsV2 — prefix filter returns 3 keys under ${TREE_PREFIX}/"
  else
    fail "ListObjectsV2 — prefix filter wrong count" "expected 3, got ${COUNT}"
  fi
else
  fail "ListObjectsV2 — prefix request failed" "$LIST"
fi

# Flat listing (no delimiter) — all 3 keys come back as Contents, no CommonPrefixes
if LIST=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
    --prefix "${TREE_PREFIX}/" --no-paginate 2>&1); then
  KEY_COUNT=$(echo "$LIST" | jq '[.Contents[]?.Key] | length')
  CP_COUNT=$(echo "$LIST" | jq '[.CommonPrefixes[]?.Prefix] | length')
  if [[ "$KEY_COUNT" == "3" && "$CP_COUNT" == "0" ]]; then
    ok "ListObjectsV2 — flat listing returns 3 Contents and 0 CommonPrefixes"
  else
    fail "ListObjectsV2 — flat listing wrong counts" \
      "keys=${KEY_COUNT} commonPrefixes=${CP_COUNT}"
  fi
fi

# Delimiter folding — sub/ should appear as a CommonPrefix, not a key.
# --no-paginate is required for the KeyCount assertion below (see comment at
# the basic-listing call): the auto-paginated merge drops KeyCount.
if LIST=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
    --prefix "${TREE_PREFIX}/" --delimiter "/" --no-paginate 2>&1); then
  KEYS=$(echo "$LIST" | jq -r '[.Contents[]?.Key] | join(",")' 2>/dev/null)
  PREFIXES=$(echo "$LIST" | jq -r '[.CommonPrefixes[]?.Prefix] | join(",")' 2>/dev/null)
  if echo ",$PREFIXES," | grep -q ",${TREE_PREFIX}/sub/," \
     && ! echo ",$KEYS," | grep -q ",${TREE_PREFIX}/sub/c.txt,"; then
    ok "ListObjectsV2 — delimiter folds 'sub/' into CommonPrefixes"
  else
    fail "ListObjectsV2 — delimiter folding incorrect" \
      "keys=[${KEYS}]  prefixes=[${PREFIXES}]"
  fi

  # KeyCount must equal Contents.length + CommonPrefixes.length.
  KC=$(echo "$LIST" | jq -r '.KeyCount // 0')
  KC_EXPECTED=$(echo "$LIST" | jq '(.Contents | length) + (.CommonPrefixes | length)')
  if [[ "$KC" == "$KC_EXPECTED" ]]; then
    ok "ListObjectsV2 — KeyCount=${KC} matches Contents+CommonPrefixes"
  else
    fail "ListObjectsV2 — KeyCount wrong" \
      "got ${KC}, expected ${KC_EXPECTED}"
  fi
else
  fail "ListObjectsV2 — delimiter request failed" "$LIST"
fi

# Empty result — prefix that matches nothing.  Contents must be empty,
# IsTruncated=false, no NextContinuationToken.
EMPTY_PREFIX="nonexistent-prefix-${TS}-zzz/"
if LIST=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
    --prefix "$EMPTY_PREFIX" --no-paginate 2>&1); then
  E_COUNT=$(echo "$LIST" | jq '[.Contents[]?.Key] | length')
  E_TRUNC=$(echo "$LIST" | jq -r '.IsTruncated // false')
  E_TOKEN=$(echo "$LIST" | jq -r '.NextContinuationToken // ""')
  if [[ "$E_COUNT" == "0" && "$E_TRUNC" == "false" && -z "$E_TOKEN" ]]; then
    ok "ListObjectsV2 — empty result (Contents=0, IsTruncated=false, no token)"
  else
    fail "ListObjectsV2 — empty result wrong shape" \
      "count=${E_COUNT} truncated=${E_TRUNC} token='${E_TOKEN}'"
  fi
else
  fail "ListObjectsV2 — empty-prefix request failed" "$LIST"
fi

# Exact-key prefix — prefix that matches exactly one key.
if LIST=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
    --prefix "$OBJECT_KEY" --no-paginate 2>&1); then
  EX_KEYS=$(echo "$LIST" | jq -r '[.Contents[]?.Key]')
  if echo "$EX_KEYS" | jq -e --arg k "$OBJECT_KEY" \
      'length == 1 and .[0] == $k' >/dev/null 2>&1; then
    ok "ListObjectsV2 — exact-key prefix returns the single matching key"
  else
    fail "ListObjectsV2 — exact-key prefix returned wrong set" "$EX_KEYS"
  fi
fi

# EncodingType=url — keys must be URL-encoded in the response (rclone and
# other clients rely on this to round-trip non-ASCII keys safely).
ENC_TREE_PREFIX="smoke-enc-${TS}/"
ENC_KEY="${ENC_TREE_PREFIX}name with space.txt"
S3 put-object --bucket "$TEST_BUCKET" --key "$ENC_KEY" \
    --body "$OBJECT_FILE" >/dev/null 2>&1 \
  || fail "EncodingType setup — could not seed '${ENC_KEY}'"
if LIST=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
    --prefix "$ENC_TREE_PREFIX" --encoding-type url --no-paginate 2>&1); then
  ENC_RAW=$(echo "$LIST" | jq -r '.Contents[]?.Key' | head -1)
  ENC_TYPE=$(echo "$LIST" | jq -r '.EncodingType // ""')
  # The space (0x20) must come back as %20 when EncodingType=url is set.
  if echo "$ENC_RAW" | grep -q '%20' && [[ "$ENC_TYPE" == "url" ]]; then
    ok "ListObjectsV2 — EncodingType=url URL-encodes keys (${ENC_RAW})"
  else
    info "ListObjectsV2 — EncodingType=url not honoured" \
      "EncodingType='${ENC_TYPE}' key='${ENC_RAW}'"
  fi
else
  fail "ListObjectsV2 — EncodingType request failed" "$LIST"
fi

# ─────────────────────────────────────────────────────────────────────────────
# ListObjectsV2 — pagination (MaxKeys + ContinuationToken drain)
# ─────────────────────────────────────────────────────────────────────────────

section "ListObjectsV2 — pagination drain"

# --no-paginate stops the CLI from merging pages; --max-keys 1 forces the
# server to emit NextContinuationToken between every key.  We walk the
# tokens manually and accumulate keys, asserting we see all 3 with no dupes.
collected=""
token=""
pages=0
truncated_seen=false
while :; do
  pages=$((pages + 1))
  if [[ $pages -gt 10 ]]; then
    fail "Pagination — runaway loop (>10 pages for 3 keys)"
    break
  fi
  if [[ -z "$token" ]]; then
    PAGE=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
        --prefix "${TREE_PREFIX}/" --max-keys 1 --no-paginate 2>&1) || {
      fail "Pagination — page request failed" "$PAGE"; break; }
  else
    PAGE=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
        --prefix "${TREE_PREFIX}/" --max-keys 1 --no-paginate \
        --continuation-token "$token" 2>&1) || {
      fail "Pagination — page request failed" "$PAGE"; break; }
  fi
  page_keys=$(echo "$PAGE" | jq -r '[.Contents[]?.Key] | join("|")')
  [[ -n "$page_keys" ]] && collected+="${page_keys}|"
  is_trunc=$(echo "$PAGE" | jq -r '.IsTruncated // false')
  token=$(echo "$PAGE" | jq -r '.NextContinuationToken // ""')
  if [[ "$is_trunc" == "true" ]]; then
    truncated_seen=true
    [[ -z "$token" ]] && { fail "Pagination — IsTruncated=true but no NextContinuationToken"; break; }
  else
    break
  fi
done

# Validate the drained set: 3 unique keys, all under the seeded prefix.
unique=$(printf '%s\n' "$collected" | tr '|' '\n' | grep -v '^$' | sort -u)
unique_count=$(echo "$unique" | grep -c '^' )
if [[ "$unique_count" == "3" ]] \
   && $truncated_seen \
   && echo "$unique" | grep -q "^${TREE_PREFIX}/a.txt$" \
   && echo "$unique" | grep -q "^${TREE_PREFIX}/b.txt$" \
   && echo "$unique" | grep -q "^${TREE_PREFIX}/sub/c.txt$"; then
  ok "Pagination — drained 3 unique keys across ${pages} pages"
else
  fail "Pagination — drain incorrect" \
    "pages=${pages} truncated_seen=${truncated_seen} unique_count=${unique_count} keys=[$(echo "$unique" | tr '\n' ',')]"
fi

# ─────────────────────────────────────────────────────────────────────────────
# ListObjectsV2 — MaxKeys clamping contract
#
# The controller (apps/backend/src/app/controllers/s3/s3.ts) clamps maxKeys to
# the inclusive range [1, 1000]: rawMaxKeys ≤ 0 silently becomes 1000, and
# any value > 1000 is capped at 1000.  These tests pin that contract.
#
# (The SDK migration fixed a latent crash on MaxKeys=0 inside buildListResult,
# but the bug can no longer reach the SDK from this controller because of the
# clamp; the fix still benefits any direct caller of the SDK function.)
# ─────────────────────────────────────────────────────────────────────────────

section "ListObjectsV2 — MaxKeys clamping"

# MaxKeys=0 → silently coerced to 1000.  Under our tree prefix (3 keys) we
# should see all 3 keys returned and IsTruncated=false.
ZERO_OUT=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
    --prefix "${TREE_PREFIX}/" --max-keys 0 --no-paginate 2>&1) \
  && ZERO_EXIT=0 || ZERO_EXIT=$?
if [[ $ZERO_EXIT -eq 0 ]]; then
  ZK_COUNT=$(echo "$ZERO_OUT" | jq '[.Contents[]?.Key] | length')
  ZK_TRUNC=$(echo "$ZERO_OUT" | jq -r '.IsTruncated // false')
  ZK_MAX=$(echo "$ZERO_OUT" | jq -r '.MaxKeys // 0')
  if [[ "$ZK_COUNT" == "3" && "$ZK_TRUNC" == "false" && "$ZK_MAX" == "1000" ]]; then
    ok "MaxKeys=0 — clamped to default 1000 (3 keys, IsTruncated=false)"
  else
    fail "MaxKeys=0 — clamp behaviour wrong" \
      "count=${ZK_COUNT} (want 3) truncated=${ZK_TRUNC} (want false) maxKeys=${ZK_MAX} (want 1000)"
  fi
else
  if echo "$ZERO_OUT" | grep -qi "between\|invalid\|MaxKeys"; then
    info "MaxKeys=0 — rejected client-side by AWS CLI; cannot probe clamp" \
      "$(echo "$ZERO_OUT" | head -1)"
  else
    fail "MaxKeys=0 — unexpected server error" "$ZERO_OUT"
  fi
fi

# MaxKeys above the upper bound → capped at 1000.  Probe with a clearly
# excessive value; we only have 3 keys to enumerate so we cannot directly
# observe the 1000 cap on Contents, but the response's echoed MaxKeys field
# must be capped.
BIG_OUT=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
    --prefix "${TREE_PREFIX}/" --max-keys 5000 --no-paginate 2>&1) \
  && BIG_EXIT=0 || BIG_EXIT=$?
if [[ $BIG_EXIT -eq 0 ]]; then
  BIG_MAX=$(echo "$BIG_OUT" | jq -r '.MaxKeys // 0')
  if [[ "$BIG_MAX" == "1000" ]]; then
    ok "MaxKeys=5000 — clamped down to 1000"
  else
    fail "MaxKeys=5000 — clamp upper bound wrong" \
      "echoed MaxKeys=${BIG_MAX} (want 1000)"
  fi
else
  if echo "$BIG_OUT" | grep -qi "between\|invalid\|MaxKeys"; then
    info "MaxKeys=5000 — rejected client-side by AWS CLI" \
      "$(echo "$BIG_OUT" | head -1)"
  else
    fail "MaxKeys=5000 — unexpected server error" "$BIG_OUT"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# PR 717 — ListObjectsV2 returns MD5 ETags (not CIDs)
# ─────────────────────────────────────────────────────────────────────────────

section "PR 717 — ListObjectsV2 returns MD5 ETags"

if LIST=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" \
    --prefix "$OBJECT_KEY" --no-paginate 2>&1); then
  LIST_ETAG=$(echo "$LIST" | jq -r \
      --arg k "$OBJECT_KEY" \
      '.Contents[] | select(.Key == $k) | .ETag' | tr -d '"')
  if [[ "$LIST_ETAG" =~ ^[0-9a-f]{32}$ ]]; then
    ok "ListObjectsV2 — ETag is MD5 format (${LIST_ETAG})"
    if [[ "$LIST_ETAG" == "$EXPECTED_MD5" ]]; then
      ok "ListObjectsV2 — ETag matches file MD5"
    else
      fail "ListObjectsV2 — ETag doesn't match file MD5" \
        "list=${LIST_ETAG}  file=${EXPECTED_MD5}"
    fi
  else
    fail "ListObjectsV2 — ETag not in MD5 format" "got: '${LIST_ETAG}'"
  fi
else
  fail "ListObjectsV2 — request failed" "$LIST"
fi

# For multipart objects, ListObjectsV2 ETag should match HeadObject ETag (the
# composite "-N" form).  Verifies the listing path returns the right shape for
# multipart-completed objects, not just single-PUT objects.
if LIST=$(S3 list-objects-v2 --bucket "$TEST_BUCKET" --prefix "$MPU_KEY" \
    --no-paginate 2>&1) \
&& HEAD=$(S3 head-object --bucket "$TEST_BUCKET" --key "$MPU_KEY" 2>&1); then
  LIST_MPU_ETAG=$(echo "$LIST" | jq -r --arg k "$MPU_KEY" \
      '.Contents[] | select(.Key == $k) | .ETag' | tr -d '"')
  HEAD_MPU_ETAG=$(echo "$HEAD" | jq -r '.ETag // ""' | tr -d '"')
  if [[ -n "$LIST_MPU_ETAG" && "$LIST_MPU_ETAG" == "$HEAD_MPU_ETAG" ]]; then
    ok "ListObjectsV2 — multipart ETag matches HEAD (${LIST_MPU_ETAG})"
  else
    fail "ListObjectsV2 — multipart ETag mismatch with HEAD" \
      "list=${LIST_MPU_ETAG}  head=${HEAD_MPU_ETAG}"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Special-character keys — spaces and unicode round-trip
# ─────────────────────────────────────────────────────────────────────────────

section "Special-character keys"

SPECIAL_KEYS=("smoke-space ${TS}.txt" "smoke-üñîçødé-${TS}.txt")
SPECIAL_FILE="${WORK}/special.txt"
printf 'special key payload' >"$SPECIAL_FILE"
SPECIAL_MD5=$(md5_of "$SPECIAL_FILE")

for sk in "${SPECIAL_KEYS[@]}"; do
  if S3 put-object --bucket "$TEST_BUCKET" --key "$sk" \
      --body "$SPECIAL_FILE" >/dev/null 2>&1; then
    SP_BACK="${WORK}/special-back.txt"
    if S3 get-object --bucket "$TEST_BUCKET" --key "$sk" \
        "$SP_BACK" >/dev/null 2>&1 \
    && cmp -s "$SPECIAL_FILE" "$SP_BACK"; then
      # Confirm HEAD finds the key with the same encoding round-trip.
      if HEAD=$(S3 head-object --bucket "$TEST_BUCKET" --key "$sk" 2>&1); then
        HEAD_ETAG=$(echo "$HEAD" | jq -r '.ETag // ""' | tr -d '"')
        if [[ "$HEAD_ETAG" == "$SPECIAL_MD5" ]]; then
          ok "Special key — '${sk}' round-trips (PUT/GET/HEAD)"
        else
          fail "Special key — HEAD ETag mismatch for '${sk}'" \
            "want ${SPECIAL_MD5}, got ${HEAD_ETAG}"
        fi
      else
        fail "Special key — HEAD failed for '${sk}'" "$HEAD"
      fi
    else
      fail "Special key — GET round-trip failed for '${sk}'"
    fi
  else
    fail "Special key — PUT failed for '${sk}'"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# Unsupported operations — informational probes
#
# These S3 methods are not in the backend's S3HandlerConfig
# (apps/backend/src/app/controllers/s3/http.ts).  Requests should be rejected;
# we don't fail the suite either way, but we report so accidental support
# additions become visible.
# ─────────────────────────────────────────────────────────────────────────────

section "Unsupported S3 operations — informational probes"

probe_unsupported() {
  local name="$1"; shift
  local out exit_code
  if out=$("$@" 2>&1); then
    exit_code=0
  else
    exit_code=$?
  fi
  if [[ $exit_code -ne 0 ]]; then
    info "${name} — rejected (as expected)"
  else
    info "${name} — accepted (contract may have changed)" \
      "$(echo "$out" | head -3 | tr '\n' '|')"
  fi
}

probe_unsupported "HeadBucket" \
  aws --endpoint-url "$ENDPOINT" --output json s3api \
  head-bucket --bucket "$TEST_BUCKET"

probe_unsupported "GetBucketLocation" \
  aws --endpoint-url "$ENDPOINT" --output json s3api \
  get-bucket-location --bucket "$TEST_BUCKET"

probe_unsupported "CopyObject" \
  aws --endpoint-url "$ENDPOINT" --output json s3api \
  copy-object --bucket "$TEST_BUCKET" \
  --copy-source "${TEST_BUCKET}/${OBJECT_KEY}" \
  --key "smoke-copy-${TS}.txt"

probe_unsupported "DeleteObjects (bulk)" \
  aws --endpoint-url "$ENDPOINT" --output json s3api \
  delete-objects --bucket "$TEST_BUCKET" \
  --delete "Objects=[{Key=${OBJECT_KEY}}]"

probe_unsupported "ListMultipartUploads" \
  aws --endpoint-url "$ENDPOINT" --output json s3api \
  list-multipart-uploads --bucket "$TEST_BUCKET"

# ListParts probe — need an UploadId.  Try one against a fresh create so a
# missing-UploadId error doesn't mask a missing-ListParts handler.
if PROBE_MPU=$(S3 create-multipart-upload \
    --bucket "$TEST_BUCKET" --key "smoke-probe-listparts-${TS}.bin" 2>&1); then
  PROBE_ID=$(echo "$PROBE_MPU" | jq -r '.UploadId')
  probe_unsupported "ListParts" \
    aws --endpoint-url "$ENDPOINT" --output json s3api \
    list-parts --bucket "$TEST_BUCKET" \
    --key "smoke-probe-listparts-${TS}.bin" \
    --upload-id "$PROBE_ID"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────

printf "\n${BOLD}══════════════════════════════════${RESET}\n"
if [[ $FAIL -gt 0 ]]; then
  printf "  ${GREEN}%d passed${RESET}   ${RED}%d failed${RESET}" "$PASS" "$FAIL"
else
  printf "  ${GREEN}%d passed${RESET}   %d failed" "$PASS" "$FAIL"
fi
[[ $INFO -gt 0 ]] && printf "   ${YELLOW}%d info${RESET}" "$INFO"
printf "\n${BOLD}══════════════════════════════════${RESET}\n\n"

[[ $FAIL -eq 0 ]]
