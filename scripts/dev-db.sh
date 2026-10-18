#!/usr/bin/env bash
# Local Postgres for development and the e2e test: a migration owner and a
# non-superuser app role, so row-level security is actually enforced.
set -euo pipefail
DB=${DB:-luxury_pos}
psql_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -q $*"; }
psql_admin "-c \"drop database if exists $DB\"" 
psql_admin "-c \"do \\\$\\\$ begin if not exists (select from pg_roles where rolname='pos') then create role pos login password 'pos' createdb; end if; if not exists (select from pg_roles where rolname='app_user') then create role app_user login password 'app' nosuperuser; end if; end \\\$\\\$\""
psql_admin "-c \"create database $DB owner pos\""
DATABASE_URL="postgres://pos:pos@localhost:5432/$DB" pnpm --filter @luxury-pos/db migrate
su postgres -c "psql -q -d $DB -c 'grant usage on schema public to app_user; grant select,insert,update,delete on all tables in schema public to app_user; grant usage,select on all sequences in schema public to app_user;'"
echo "ready: postgres://app_user:app@localhost:5432/$DB"
