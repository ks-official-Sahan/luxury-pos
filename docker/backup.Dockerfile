# syntax=docker/dockerfile:1
# pg_dump/pg_restore matched to the server major (17). Used by the compose `ops` profile.
FROM postgres:17-alpine
RUN apk add --no-cache aws-cli age bash
COPY scripts/backup.sh /usr/local/bin/backup.sh
COPY scripts/restore.sh /usr/local/bin/restore.sh
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh \
 && mkdir -p /backups && chown postgres:postgres /backups
USER postgres
