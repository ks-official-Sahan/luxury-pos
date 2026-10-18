#!/usr/bin/env bash
# Usage: restore.sh <file|s3-uri> [target_db_url]   (target falls back to RESTORE_DATABASE_URL)
set -euo pipefail

log() { printf '[backup] %s restore: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

[[ $# -ge 1 ]] || die "usage: restore.sh <file|s3-uri> [target_db_url]"
SRC=$1
TARGET=${2:-${RESTORE_DATABASE_URL:-}}
[[ -n $TARGET ]] || die "target DB URL required (arg 2 or RESTORE_DATABASE_URL)"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

S3_ARGS=()
[[ -n ${BACKUP_S3_ENDPOINT:-} ]] && S3_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")

if [[ $SRC == s3://* ]]; then
  FILE="$WORK/$(basename "$SRC")"
  aws "${S3_ARGS[@]}" s3 cp "$SRC" "$FILE" --only-show-errors || die "download failed"
  if ! aws "${S3_ARGS[@]}" s3 cp "$SRC.sha256" "$FILE.sha256" --only-show-errors 2>/dev/null; then
    rm -f "$FILE.sha256"
  fi
  SIDECAR="$FILE.sha256"
else
  [[ -f $SRC ]] || die "not found: $SRC"
  FILE=$SRC
  SIDECAR="$SRC.sha256"
fi

if [[ -f ${SIDECAR:-} ]]; then
  expected=$(awk '{print $1}' "$SIDECAR")
  actual=$(sha256sum "$FILE" | awk '{print $1}')
  [[ $expected == "$actual" ]] || die "sha256 mismatch for $(basename "$FILE")"
  log "sha256 ok"
else
  log "no sha256 sidecar, skipping checksum"
fi

if [[ $FILE == *.age ]]; then
  : "${AGE_IDENTITY:?AGE_IDENTITY (identity file path) required to decrypt}"
  DUMP="$WORK/plain.dump"
  age -d -i "$AGE_IDENTITY" -o "$DUMP" "$FILE" || die "decryption failed"
else
  DUMP=$FILE
fi

pg_restore --list "$DUMP" >/dev/null || die "not a valid pg_dump archive"

DB_NAME=$(printf '%s' "$TARGET" | sed -E 's/[?].*$//; s#.*/##')
if [[ $DB_NAME != *_restore && ${FORCE_RESTORE:-0} != 1 ]]; then
  die "refusing to restore into '$DB_NAME' (name must end with _restore, or set FORCE_RESTORE=1)"
fi

log "restoring into '$DB_NAME'"
pg_restore --clean --if-exists --no-owner -d "$TARGET" "$DUMP" || die "pg_restore failed"
log "done"
