#!/usr/bin/env bash
# Logical dump of the owner DB. Off-site copies are for portability; Neon PITR covers point-in-time.
set -euo pipefail

log() { printf '[backup] %s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL (owner role) is required}"
BACKUP_DIR=${BACKUP_DIR:-/backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE="luxury_pos-${STAMP}.dump"
PARTIAL="$BACKUP_DIR/.${BASE}.partial"
DUMP="$BACKUP_DIR/$BASE"
FINAL="$DUMP"

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$PARTIAL"' EXIT

log "dump start -> $BASE"
pg_dump -Fc --no-owner -d "$BACKUP_DATABASE_URL" -f "$PARTIAL" || die "pg_dump failed"
mv "$PARTIAL" "$DUMP"

pg_restore --list "$DUMP" >/dev/null || die "dump failed pg_restore --list verification"
log "verified $(stat -c %s "$DUMP") bytes"

if [[ -n ${AGE_RECIPIENT:-} ]]; then
  FINAL="$DUMP.age"
  if ! age -r "$AGE_RECIPIENT" -o "$FINAL" "$DUMP"; then
    rm -f "$FINAL" "$DUMP"
    die "age encryption failed"
  fi
  rm -f "$DUMP"
  log "encrypted -> $(basename "$FINAL")"
fi

FILE_BASE=$(basename "$FINAL")
(cd "$BACKUP_DIR" && sha256sum "$FILE_BASE" > "$FILE_BASE.sha256")
log "sha256 written"

if [[ -n ${BACKUP_S3_URI:-} ]]; then
  S3_ARGS=()
  [[ -n ${BACKUP_S3_ENDPOINT:-} ]] && S3_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  DEST=${BACKUP_S3_URI%/}
  aws "${S3_ARGS[@]}" s3 cp "$FINAL" "$DEST/$FILE_BASE" --only-show-errors || die "upload failed"
  aws "${S3_ARGS[@]}" s3 cp "$FINAL.sha256" "$DEST/$FILE_BASE.sha256" --only-show-errors || die "sidecar upload failed"
  log "uploaded -> $DEST/$FILE_BASE"
fi

# Local retention. Set a bucket lifecycle rule for off-site retention.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'luxury_pos-*' -mtime "+$RETENTION_DAYS" -print -delete \
  | sed 's/^/[backup] pruned /' || true

log "done"
