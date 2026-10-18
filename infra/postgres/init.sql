-- Dev-only bootstrap. Runs once, on an empty volume (docker-entrypoint-initdb.d).
-- pos: owner, runs migrations. app_user: NOSUPERUSER + NOBYPASSRLS so RLS is enforced.
-- Passwords here are dev-only and must match POS_DB_PASSWORD / APP_DB_PASSWORD in .env.docker.
CREATE ROLE pos LOGIN PASSWORD 'pos_dev_only' CREATEDB NOSUPERUSER;
CREATE ROLE app_user LOGIN PASSWORD 'app_dev_only' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE luxury_pos OWNER pos;
