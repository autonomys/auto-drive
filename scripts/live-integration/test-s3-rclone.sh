#!/usr/bin/env bash
#
# test-s3-rclone.sh — Integration tests for rclone's S3 backend against the
# Auto Drive S3 API.
#
# Verifies that rclone (a common third-party S3 client) interoperates
# correctly with our endpoint.  Exercises the code paths rclone hits in
# normal use: ListObjectsV2, single-PUT, multipart-PUT, GET, DeleteObject
# rejection, and MD5 checksum verification.
#
# Companion to test-s3-api.sh, which tests the API surface directly via
# the AWS CLI.  Split out so this script can evolve independently as new
# rclone-specific quirks surface, and so the API tests don't silently
# skip rclone coverage when no remote is configured.
#
# Coverage:
#   Listing
#     rclone ls          — ListObjectsV2 via rclone's list_version=2
#     rclone lsd         — directory-only listing (CommonPrefixes)
#     rclone lsjson      — rich per-object metadata
#     rclone lsf -R      — recursive formatted listing
#     rclone tree        — ASCII tree (recursive, delimiter-folded)
#     rclone size        — pagination drain + size-from-listing
#     rclone hashsum md5 — per-object MD5s from server ETags (PR 717)
#   Read
#     rclone cat         — streamed body to stdout
#     rclone cat --offset/--count — byte-range read
#     rclone check       — MD5 verification against server ETags
#   Write
#     rclone copyto      — small-file PUT/GET round-trip
#     rclone copyto      — multipart PUT (6 MiB, 5 MiB chunks)
#     rclone copy        — recursive directory upload
#     rclone rcat        — pipe-in upload from stdin
#   Immutability (must reject)
#     rclone deletefile  — single-file delete
#     rclone delete      — filter-based delete
#     rclone purge       — recursive prefix delete
#     rclone moveto      — copy + delete
#
# Data hygiene: storage on Auto Drive is immutable and content-addressed.  All
# upload content is deterministic (no timestamps or randomness in bodies), so
# repeat runs hash to identical CIDs and consume no new DSN storage after the
# first run.  The 6 MiB multipart fixture is the smallest content that can
# produce >1 chunk under rclone's 5 MiB client-side minimum.
#
# Prerequisites:
#   aws     AWS CLI v2          https://aws.amazon.com/cli/  (for seed PUT)
#   jq      JSON processor      https://stedolan.github.io/jq/
#   rclone                      https://rclone.org/
#   A configured rclone remote named "${RCLONE_REMOTE}" pointing at the
#   Auto Drive S3 endpoint with list_version=2.
#
# Usage:
#   AUTO_DRIVE_API_KEY=<api_key> ./scripts/live-integration/test-s3-rclone.sh
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

PASS=0; FAIL=0; INFO=0

ok()      { printf "  ${GREEN}✓${RESET}  %s\n" "$1"; PASS=$((PASS+1)); }
fail()    { printf "  ${RED}✗${RESET}  %s\n" "$1"
            [ -n "${2:-}" ] && printf "      ${DIM}%s${RESET}\n" "$2"
            FAIL=$((FAIL+1)); }
info()    { printf "  ${YELLOW}ℹ${RESET}  %s\n" "$1"
            [ -n "${2:-}" ] && printf "      ${DIM}%s${RESET}\n" "$2"
            INFO=$((INFO+1)); }
section() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

# Portable md5 — macOS ships `md5 -q`, Linux ships `md5sum`.
md5_of() {
  if command -v md5 >/dev/null 2>&1; then md5 -q "$1"
  else md5sum "$1" | awk '{print $1}'; fi
}

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

for cmd in aws jq rclone; do
  if ! command -v "$cmd" &>/dev/null; then
    printf "ERROR: '%s' is required but not found in PATH.\n" "$cmd"
    exit 1
  fi
done

if ! rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:"; then
  printf "ERROR: rclone remote '%s:' is not configured.\n" "$RCLONE_REMOTE"
  printf "       Configure with 'rclone config' (S3 backend, custom endpoint,\n"
  printf "       list_version=2) or override with RCLONE_REMOTE=<name>.\n"
  exit 1
fi

# ── AWS CLI (used only for the seed PUT) ──────────────────────────────────────

export AWS_ACCESS_KEY_ID="$API_KEY"
export AWS_SECRET_ACCESS_KEY="placeholder"
export AWS_DEFAULT_REGION="us-east-1"

# Suppress aws-chunked encoding (see test-s3-api.sh for rationale).
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

AWS_CFG_DIR="${WORK}/aws"
mkdir -p "$AWS_CFG_DIR"
printf '[default]\nrequest_checksum_calculation = when_required\n' \
  > "${AWS_CFG_DIR}/config"
export AWS_CONFIG_FILE="${AWS_CFG_DIR}/config"

S3() { aws --endpoint-url "$ENDPOINT" --output json s3api "$@"; }

# ── Seed: upload a key via aws-cli so rclone has something to list ────────────

TS=$(date +%s)
SEED_KEY="smoke-rclone-seed-${TS}.txt"
SEED_FILE="${WORK}/seed.txt"
printf 'rclone integration seed fixture body' >"$SEED_FILE"

if ! S3 put-object \
    --bucket "$TEST_BUCKET" \
    --key "$SEED_KEY" \
    --body "$SEED_FILE" \
    --content-type "text/plain" >/dev/null 2>&1; then
  printf "ERROR: seed PutObject failed.  Cannot run rclone tests without it.\n"
  exit 1
fi

# ── Banner ────────────────────────────────────────────────────────────────────

printf "\n${BOLD}Auto Drive S3 — rclone integration tests${RESET}\n"
printf "Endpoint  %s\n" "$ENDPOINT"
printf "Bucket    %s\n" "$TEST_BUCKET"
printf "Remote    %s:\n" "$RCLONE_REMOTE"

RC_DIR="${WORK}/rclone"
mkdir -p "$RC_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# rclone ls — ListObjectsV2 via rclone's list_version=2
# ─────────────────────────────────────────────────────────────────────────────

section "rclone ls"

RCLONE_OUT=$(rclone ls "${RCLONE_REMOTE}:${TEST_BUCKET}" 2>&1) \
  && RC_EXIT=0 || RC_EXIT=$?
if [[ $RC_EXIT -eq 0 ]]; then
  if echo "$RCLONE_OUT" | grep -q "$SEED_KEY"; then
    ok "rclone ls — returns the seeded key"
  else
    fail "rclone ls — seeded key not in listing" \
      "first 3 lines: $(echo "$RCLONE_OUT" | head -3 | tr '\n' '|')"
  fi
else
  fail "rclone ls — failed" "$RCLONE_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone copyto — small-file PUT/GET round-trip
# ─────────────────────────────────────────────────────────────────────────────

section "rclone copyto — small file"

RC_SMALL="${RC_DIR}/small.txt"
RC_SMALL_KEY="rclone-small-${TS}.txt"
printf 'rclone small upload test' >"$RC_SMALL"
if rclone copyto "$RC_SMALL" \
     "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_SMALL_KEY}" \
     --immutable 2>/dev/null; then
  RC_BACK="${RC_DIR}/small-back.txt"
  if rclone copyto "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_SMALL_KEY}" \
      "$RC_BACK" 2>/dev/null && \
     [[ "$(cat "$RC_SMALL")" == "$(cat "$RC_BACK")" ]]; then
    ok "rclone copyto — upload, download, content matches"
  else
    fail "rclone copyto — download or content mismatch"
  fi
else
  fail "rclone copyto — upload failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone copyto — multipart (6 MiB, 5 MiB chunks)
# ─────────────────────────────────────────────────────────────────────────────

section "rclone copyto — multipart"

RC_LARGE="${RC_DIR}/large.bin"
RC_LARGE_KEY="rclone-mpu-${TS}.bin"
# 6 MiB of zeros — deterministic so the DSN deduplicates after the first run
# (storage is content-addressed; identical bytes hash to the same CID).
# rclone's S3 backend enforces a 5 MiB minimum chunk size client-side, so this
# is the smallest content that can produce more than one chunk.
dd if=/dev/zero of="$RC_LARGE" bs=1048576 count=6 2>/dev/null
# --s3-upload-cutoff 5M is required to force the multipart path: rclone's
# default cutoff is 200 MiB, so a 6 MiB file would otherwise go as a single
# PUT regardless of --s3-chunk-size.
if rclone copyto "$RC_LARGE" \
     "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_LARGE_KEY}" \
     --immutable --s3-chunk-size 5M --s3-upload-cutoff 5M 2>/dev/null; then
  REMOTE_SIZE=$(rclone size --json \
      "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_LARGE_KEY}" 2>/dev/null \
      | jq -r '.bytes')
  LOCAL_SIZE=$(wc -c <"$RC_LARGE" | tr -d ' ')
  if [[ "$REMOTE_SIZE" == "$LOCAL_SIZE" ]]; then
    ok "rclone multipart — 6 MiB upload + size match (${LOCAL_SIZE} B)"
  else
    fail "rclone multipart — size mismatch" \
      "local=${LOCAL_SIZE}  remote=${REMOTE_SIZE}"
  fi
else
  fail "rclone multipart — upload failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone deletefile — DeleteObject is rejected
# ─────────────────────────────────────────────────────────────────────────────

section "rclone deletefile"

DEL_OUT=$(rclone deletefile \
    "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_SMALL_KEY}" 2>&1) \
  && DEL_EXIT=0 || DEL_EXIT=$?
if [[ $DEL_EXIT -ne 0 ]]; then
  ok "rclone deletefile — correctly rejected (storage is immutable)"
else
  fail "rclone deletefile — expected failure but command succeeded" "$DEL_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone check — MD5 verification (relies on PR 717's MD5 ETags in listings)
# ─────────────────────────────────────────────────────────────────────────────

section "rclone check"

RC_CHK_DIR="${WORK}/rclone-check"
mkdir -p "$RC_CHK_DIR"
RC_CHK_FILE="smoke-chk-${TS}.txt"
printf 'rclone checksum smoke test' >"${RC_CHK_DIR}/${RC_CHK_FILE}"

# Upload via AWS CLI so the server stores the MD5 ETag the same way as
# production traffic.  rclone check then compares local MD5s against the
# server's ETag — before PR 695 this failed (ETag was the CID); after
# PR 717 the ListObjectsV2 path also returns MD5, so rclone gets a real
# MD5 from both Head and List code paths.
S3 put-object \
    --bucket "$TEST_BUCKET" \
    --key "$RC_CHK_FILE" \
    --body "${RC_CHK_DIR}/${RC_CHK_FILE}" \
    --content-type "text/plain" >/dev/null 2>&1

RCLONE_OUT=$(rclone check \
    "$RC_CHK_DIR" \
    "${RCLONE_REMOTE}:${TEST_BUCKET}" \
    --include "$RC_CHK_FILE" 2>&1) && RC_EXIT=0 || RC_EXIT=$?

if [[ $RC_EXIT -eq 0 ]]; then
  ok "rclone check — passes without --ignore-checksum"
else
  fail "rclone check — MD5 verification failed" "$RCLONE_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone copy — recursive directory upload
# Seeds a small tree that downstream listing tests depend on, while also
# exercising rclone's batched / concurrent PUT path.
# ─────────────────────────────────────────────────────────────────────────────

section "rclone copy — recursive directory"

RC_TREE_DIR="${WORK}/rclone-tree"
mkdir -p "${RC_TREE_DIR}/sub"
printf 'rclone tree fixture — a content' >"${RC_TREE_DIR}/a.txt"
printf 'rclone tree fixture — b content with a longer body' >"${RC_TREE_DIR}/b.txt"
printf 'rclone tree fixture — c content nested under sub/' >"${RC_TREE_DIR}/sub/c.txt"

RC_TREE_PREFIX="rclone-tree-${TS}"
RC_TREE_LOCAL_BYTES=$(( \
  $(wc -c <"${RC_TREE_DIR}/a.txt") + \
  $(wc -c <"${RC_TREE_DIR}/b.txt") + \
  $(wc -c <"${RC_TREE_DIR}/sub/c.txt") ))

if rclone copy "$RC_TREE_DIR" \
     "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" \
     --immutable 2>/dev/null; then
  # Verify all three files made it via a flat recursive ls.
  TREE_LS=$(rclone ls "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" 2>/dev/null)
  if echo "$TREE_LS" | grep -q ' a\.txt$' \
  && echo "$TREE_LS" | grep -q ' b\.txt$' \
  && echo "$TREE_LS" | grep -q ' sub/c\.txt$'; then
    ok "rclone copy — uploaded 3 files recursively into ${RC_TREE_PREFIX}/"
  else
    fail "rclone copy — not all 3 files present after upload" \
      "ls output: $(echo "$TREE_LS" | tr '\n' '|')"
  fi
else
  fail "rclone copy — recursive upload failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone lsd — directory-only listing (CommonPrefixes)
# At the tree prefix root, only "sub" should appear as a directory; a.txt and
# b.txt are files and must NOT be in lsd output.
# ─────────────────────────────────────────────────────────────────────────────

section "rclone lsd — directory listing"

LSD_OUT=$(rclone lsd "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" 2>&1) \
  && RC_EXIT=0 || RC_EXIT=$?
if [[ $RC_EXIT -eq 0 ]]; then
  if echo "$LSD_OUT" | awk '{print $NF}' | grep -qx 'sub' \
  && ! echo "$LSD_OUT" | awk '{print $NF}' | grep -qx 'a.txt' \
  && ! echo "$LSD_OUT" | awk '{print $NF}' | grep -qx 'b.txt'; then
    ok "rclone lsd — 'sub' appears as a directory; files excluded"
  else
    fail "rclone lsd — wrong shape" "$(echo "$LSD_OUT" | head -5 | tr '\n' '|')"
  fi
else
  fail "rclone lsd — failed" "$LSD_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone lsjson — rich per-object metadata
# Verifies the populated JSON shape rclone produces from ListObjectsV2:
# Name/Size/ModTime/IsDir all present, correct file vs. directory split.
# ─────────────────────────────────────────────────────────────────────────────

section "rclone lsjson — JSON metadata"

LSJSON_OUT=$(rclone lsjson "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" 2>&1) \
  && RC_EXIT=0 || RC_EXIT=$?
if [[ $RC_EXIT -eq 0 ]]; then
  # Expect 3 entries at the top level: a.txt, b.txt, sub/  (lsjson is non-recursive).
  ENTRY_COUNT=$(echo "$LSJSON_OUT" | jq 'length' 2>/dev/null)
  HAS_FIELDS=$(echo "$LSJSON_OUT" | \
      jq '[.[] | (has("Name") and has("Size") and has("ModTime") and has("IsDir"))] | all' 2>/dev/null)
  DIR_COUNT=$(echo "$LSJSON_OUT" | jq '[.[] | select(.IsDir == true)] | length' 2>/dev/null)
  FILE_COUNT=$(echo "$LSJSON_OUT" | jq '[.[] | select(.IsDir == false)] | length' 2>/dev/null)
  if [[ "$ENTRY_COUNT" == "3" && "$HAS_FIELDS" == "true" \
     && "$DIR_COUNT" == "1" && "$FILE_COUNT" == "2" ]]; then
    ok "rclone lsjson — 3 entries (2 files + 1 dir), all required fields present"
  else
    fail "rclone lsjson — wrong shape" \
      "count=${ENTRY_COUNT} fields=${HAS_FIELDS} dirs=${DIR_COUNT} files=${FILE_COUNT}"
  fi
else
  fail "rclone lsjson — failed" "$LSJSON_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone lsf -R — recursive formatted listing
# Should emit every key under the prefix, plus the sub/ directory marker.
# ─────────────────────────────────────────────────────────────────────────────

section "rclone lsf -R — recursive listing"

LSF_OUT=$(rclone lsf -R "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" 2>&1) \
  && RC_EXIT=0 || RC_EXIT=$?
if [[ $RC_EXIT -eq 0 ]]; then
  if echo "$LSF_OUT" | grep -qx 'a.txt' \
  && echo "$LSF_OUT" | grep -qx 'b.txt' \
  && echo "$LSF_OUT" | grep -qx 'sub/c.txt'; then
    ok "rclone lsf -R — all 3 keys present (including nested sub/c.txt)"
  else
    fail "rclone lsf -R — keys missing" "$(echo "$LSF_OUT" | tr '\n' '|')"
  fi
else
  fail "rclone lsf -R — failed" "$LSF_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone tree — ASCII tree (recursive, delimiter-folded)
# ─────────────────────────────────────────────────────────────────────────────

section "rclone tree"

TREE_OUT=$(rclone tree "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" 2>&1) \
  && RC_EXIT=0 || RC_EXIT=$?
if [[ $RC_EXIT -eq 0 ]]; then
  if echo "$TREE_OUT" | grep -q 'a.txt' \
  && echo "$TREE_OUT" | grep -q 'b.txt' \
  && echo "$TREE_OUT" | grep -q 'sub' \
  && echo "$TREE_OUT" | grep -q 'c.txt'; then
    ok "rclone tree — all files and sub-directory rendered"
  else
    fail "rclone tree — output incomplete" "$(echo "$TREE_OUT" | head -10 | tr '\n' '|')"
  fi
else
  fail "rclone tree — failed" "$TREE_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone size — full pagination drain + size-from-listing
# ─────────────────────────────────────────────────────────────────────────────

section "rclone size"

SIZE_JSON=$(rclone size --json \
    "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" 2>&1) \
  && RC_EXIT=0 || RC_EXIT=$?
if [[ $RC_EXIT -eq 0 ]]; then
  SIZE_COUNT=$(echo "$SIZE_JSON" | jq -r '.count' 2>/dev/null)
  SIZE_BYTES=$(echo "$SIZE_JSON" | jq -r '.bytes' 2>/dev/null)
  if [[ "$SIZE_COUNT" == "3" && "$SIZE_BYTES" == "$RC_TREE_LOCAL_BYTES" ]]; then
    ok "rclone size — count=3, bytes=${SIZE_BYTES} match local total"
  else
    fail "rclone size — mismatch" \
      "count=${SIZE_COUNT} (want 3)  bytes=${SIZE_BYTES} (want ${RC_TREE_LOCAL_BYTES})"
  fi
else
  fail "rclone size — failed" "$SIZE_JSON"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone hashsum md5 — per-object MD5s from server ETags (PR 717)
# ─────────────────────────────────────────────────────────────────────────────

section "rclone hashsum md5"

HASH_OUT=$(rclone hashsum md5 \
    "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" 2>&1) \
  && RC_EXIT=0 || RC_EXIT=$?
if [[ $RC_EXIT -eq 0 ]]; then
  # rclone emits "<md5>  <path>" per line.  Compare each to the local file's MD5.
  EXPECT_A=$(md5_of "${RC_TREE_DIR}/a.txt")
  EXPECT_B=$(md5_of "${RC_TREE_DIR}/b.txt")
  EXPECT_C=$(md5_of "${RC_TREE_DIR}/sub/c.txt")
  REMOTE_A=$(echo "$HASH_OUT" | awk '$2 == "a.txt"     { print $1 }')
  REMOTE_B=$(echo "$HASH_OUT" | awk '$2 == "b.txt"     { print $1 }')
  REMOTE_C=$(echo "$HASH_OUT" | awk '$2 == "sub/c.txt" { print $1 }')
  if [[ "$EXPECT_A" == "$REMOTE_A" \
     && "$EXPECT_B" == "$REMOTE_B" \
     && "$EXPECT_C" == "$REMOTE_C" ]]; then
    ok "rclone hashsum md5 — all 3 server MD5s match local files"
  else
    fail "rclone hashsum md5 — mismatch" \
      "a: local=${EXPECT_A} remote=${REMOTE_A}; b: local=${EXPECT_B} remote=${REMOTE_B}; c: local=${EXPECT_C} remote=${REMOTE_C}"
  fi
else
  fail "rclone hashsum md5 — failed" "$HASH_OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone cat — streams object body to stdout (no temp file)
# ─────────────────────────────────────────────────────────────────────────────

section "rclone cat"

CAT_OUT=$(rclone cat "${RCLONE_REMOTE}:${TEST_BUCKET}/${SEED_KEY}" 2>&1) \
  && RC_EXIT=0 || RC_EXIT=$?
if [[ $RC_EXIT -eq 0 ]]; then
  EXPECTED_FULL=$(cat "$SEED_FILE")
  if [[ "$CAT_OUT" == "$EXPECTED_FULL" ]]; then
    ok "rclone cat — full body matches"
  else
    fail "rclone cat — body mismatch" \
      "want '${EXPECTED_FULL}', got '${CAT_OUT}'"
  fi
else
  fail "rclone cat — failed" "$CAT_OUT"
fi

# rclone cat --offset / --count — byte-range read via rclone (translates to
# GetObject Range under the hood; companion to the API script's Range test
# from a client perspective).
RANGE_OFFSET=0
RANGE_COUNT=10
CAT_RANGE=$(rclone cat \
    --offset "$RANGE_OFFSET" --count "$RANGE_COUNT" \
    "${RCLONE_REMOTE}:${TEST_BUCKET}/${SEED_KEY}" 2>&1) \
  && RC_EXIT=0 || RC_EXIT=$?
if [[ $RC_EXIT -eq 0 ]]; then
  EXPECTED_RANGE=$(head -c "$RANGE_COUNT" "$SEED_FILE")
  if [[ "$CAT_RANGE" == "$EXPECTED_RANGE" ]]; then
    ok "rclone cat --offset=${RANGE_OFFSET} --count=${RANGE_COUNT} — bytes match"
  else
    fail "rclone cat range — mismatch" \
      "want '${EXPECTED_RANGE}', got '${CAT_RANGE}'"
  fi
else
  fail "rclone cat --offset/--count — failed" "$CAT_RANGE"
fi

# ─────────────────────────────────────────────────────────────────────────────
# rclone rcat — pipe-in upload (streamed from stdin)
# ─────────────────────────────────────────────────────────────────────────────

section "rclone rcat — stdin upload"

RCAT_KEY="rclone-rcat-${TS}.txt"
RCAT_CONTENT="rclone rcat stdin upload fixture body"
if printf '%s' "$RCAT_CONTENT" | rclone rcat \
     "${RCLONE_REMOTE}:${TEST_BUCKET}/${RCAT_KEY}" 2>/dev/null; then
  RCAT_BACK=$(rclone cat "${RCLONE_REMOTE}:${TEST_BUCKET}/${RCAT_KEY}" 2>/dev/null)
  if [[ "$RCAT_BACK" == "$RCAT_CONTENT" ]]; then
    ok "rclone rcat — stdin upload round-trips byte-for-byte"
  else
    fail "rclone rcat — body mismatch on readback" \
      "want '${RCAT_CONTENT}', got '${RCAT_BACK}'"
  fi
else
  fail "rclone rcat — stdin upload failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Immutability rejection probes — every operation that requires DeleteObject
# must fail.  These are negative tests, companion to the existing deletefile
# rejection above.
# ─────────────────────────────────────────────────────────────────────────────

section "Immutability — delete / purge / moveto rejection"

# rclone delete — non-recursive single-file delete (uses --include filter)
RDEL_OUT=$(rclone delete --include "${RC_SMALL_KEY}" \
    "${RCLONE_REMOTE}:${TEST_BUCKET}" 2>&1) \
  && RDEL_EXIT=0 || RDEL_EXIT=$?
if [[ $RDEL_EXIT -ne 0 ]] \
   || echo "$RDEL_OUT" | grep -qi "failed\|denied\|forbidden\|403"; then
  ok "rclone delete — rejected"
else
  # `rclone delete` can exit 0 if it deletes zero files; verify the file is
  # still there as a fallback signal.
  STILL_THERE=$(rclone ls "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_SMALL_KEY}" 2>/dev/null)
  if [[ -n "$STILL_THERE" ]]; then
    ok "rclone delete — exited 0 but file still present (delete had no effect)"
  else
    fail "rclone delete — file appears to have been deleted" "$RDEL_OUT"
  fi
fi

# rclone purge — recursive delete of a prefix.  Should fail outright.
RPURGE_OUT=$(rclone purge \
    "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" 2>&1) \
  && RPURGE_EXIT=0 || RPURGE_EXIT=$?
if [[ $RPURGE_EXIT -ne 0 ]]; then
  ok "rclone purge — correctly rejected"
else
  # If purge somehow exited 0, the tree should still be intact.
  REMAINING=$(rclone ls "${RCLONE_REMOTE}:${TEST_BUCKET}/${RC_TREE_PREFIX}" 2>/dev/null \
              | wc -l | tr -d ' ')
  if [[ "$REMAINING" == "3" ]]; then
    ok "rclone purge — exited 0 but tree intact (purge had no effect)"
  else
    fail "rclone purge — tree was modified" \
      "remaining=${REMAINING} (expected 3)  output: ${RPURGE_OUT}"
  fi
fi

# rclone moveto — copy + delete.  Either step is enough to fail the move:
#   - we have no CopyObject (server-side copy), so rclone falls back to
#     download-then-upload-then-delete; the delete then 403s
#   - or rclone refuses to start a move when the source can't be deleted
RMOVE_DST="${SEED_KEY}.moved-${TS}"
RMOVE_OUT=$(rclone moveto \
    "${RCLONE_REMOTE}:${TEST_BUCKET}/${SEED_KEY}" \
    "${RCLONE_REMOTE}:${TEST_BUCKET}/${RMOVE_DST}" 2>&1) \
  && RMOVE_EXIT=0 || RMOVE_EXIT=$?
SRC_STILL_THERE=$(rclone ls "${RCLONE_REMOTE}:${TEST_BUCKET}/${SEED_KEY}" 2>/dev/null)
if [[ -n "$SRC_STILL_THERE" ]]; then
  if [[ $RMOVE_EXIT -ne 0 ]]; then
    ok "rclone moveto — rejected; source still present"
  else
    ok "rclone moveto — exited 0 but source still present (delete refused)"
  fi
else
  fail "rclone moveto — source was deleted (immutability violated)" "$RMOVE_OUT"
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
