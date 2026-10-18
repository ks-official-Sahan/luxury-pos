# Operations runbook

Stack: nginx (web + API edge), Hono API, worker, Postgres 17, Redis (Upstash REST stand-in), optional Redpanda and backups.

## Services

| Service | Image | Port | Profile | Notes |
|---|---|---|---|---|
| postgres | postgres:17-alpine | internal 5432 | | Roles and DB from `infra/postgres/init.sql` |
| migrate | luxury-pos/api | | | One-shot, owner role `pos` |
| grants | postgres:17-alpine | | | One-shot, `infra/postgres/grants.sql` as `pos` |
| redis / redis-http | redis:7-alpine / serverless-redis-http | internal | | REST at `http://redis-http:80` |
| api | luxury-pos/api | internal 8787 | | Health `GET /healthz` |
| worker | luxury-pos/api | none | | Same image, `worker.ts` |
| web | luxury-pos/web (nginx) | **8080** | | Serves SPA, proxies `/api`, `/mcp`, `/healthz` |
| redpanda | redpanda | internal 9092 | `events` | Kafka dev broker |
| backup | luxury-pos/backup | none | `ops` | Daily dump loop |

## First run

```sh
cp .env.docker.example .env.docker   # edit secrets
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker --profile events --profile ops up -d   # optional services
```

Open `http://localhost:8080`. Only `web` is published.

## Migrations

- `migrate` runs on every `up` before `grants` and `api`. Migrations run as owner `pos`.
- `grants` re-applies privileges for `app_user` after each migrate. It is idempotent.
- Manual re-run:

```sh
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker run --rm grants
```

- Production (Neon or managed Postgres): run migrate and grants from CI or a release job, not from the app container.

## Scaling

```sh
docker compose --env-file .env.docker up -d --scale worker=3
docker compose --env-file .env.docker up -d --scale api=3
docker compose --env-file .env.docker restart web   # nginx resolves api DNS at start
```

- Worker replicas are stateless. Scale freely, subject to DB connection limits.
- nginx resolves upstream hostnames once at startup. Restart `web` after API replica changes.
- Compose-local clients appear as the bridge gateway IP, so per-IP rate limits are shared. Use a real LB in front for true per-client limits.

## nginx edge

| Path | Policy |
|---|---|
| `/_expo/`, `/assets/` | `Cache-Control: public, max-age=31536000, immutable`; missing file returns 404 |
| `/` (SPA) | `no-cache`; falls back to `index.html` |
| `/api/auth/`, `/api/signup` | rate limit `auth` (10 req/min, burst 5) |
| `/api/public/` | proxy cache, GET/HEAD, 200 for 60s, stale-on-error, lock, `X-Cache-Status` |
| `/api/` | no cache; rate limit `apilimit` (30 req/s, burst 60); retry only idempotent methods |
| `/mcp` | no buffering, 300s read timeout, upgrade-aware |
| `/healthz` | proxied to API, access log off |

- Cache is keyed on scheme, host and URI. Requests with `Authorization`, or responses with `Set-Cookie`, are never stored.
- Fallback upstream: set `API_FALLBACK_UPSTREAM` (for example `django:8000`). It receives traffic only when the primary fails (`max_fails=3 fail_timeout=10s`). Non-idempotent requests are not retried.
- Change upstreams in `.env.docker` and restart `web`.
- Client IP: `real_ip` trusts `10/8`, `172.16/12`, `192.168/16`. Set `TRUSTED_PROXY_HOPS` to match the API's hop count.
- HSTS: uncomment in `infra/nginx/templates/default.conf.template` only behind TLS.
- Body limit: 1 MB (`client_max_body_size`).

## Backups

| Item | Value |
|---|---|
| Format | `pg_dump -Fc --no-owner`, verified with `pg_restore --list` before encryption |
| Output | `/backups/luxury_pos-<UTC>.dump` (+ `.sha256`, or `.age` when `AGE_RECIPIENT` set) |
| Schedule | Loop every `BACKUP_INTERVAL_SECONDS` (default 86400) |
| Retention | Local: `BACKUP_RETENTION_DAYS` (default 14). Off-site: bucket lifecycle rule |
| Off-site | `BACKUP_S3_URI=s3://bucket/prefix`, `BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `AWS_DEFAULT_REGION=auto` (R2) |

Run once:

```sh
docker compose --env-file .env.docker --profile ops run --rm backup /usr/local/bin/backup.sh
```

**Neon PITR note:** Neon provides point-in-time restore. Logical dumps are for portability and off-site copies, not the primary recovery path.

### Restore drill (monthly)

1. Create a scratch DB owned by `pos`, named with the `_restore` suffix (restore refuses other names unless `FORCE_RESTORE=1`):

   ```sh
   docker compose exec postgres psql -U postgres -c "create database luxury_pos_restore owner pos"
   ```

2. Restore. Set `AGE_IDENTITY` and mount the identity file if encrypted:

   ```sh
   docker compose --env-file .env.docker --profile ops run --rm backup \
     /usr/local/bin/restore.sh /backups/<file>.dump postgres://pos:<pw>@postgres:5432/luxury_pos_restore
   ```

3. Smoke-test row counts on key tables. Record duration and result. Drop the scratch DB.

`restore.sh` accepts an `s3://` URI and checks the `.sha256` sidecar when present.

## Kafka (events profile)

```sh
# .env.docker
KAFKA_BROKERS=redpanda:9092
```

Then `up -d --profile events`. Leave `KAFKA_BROKERS` empty to disable publishing.

## Health checks

| Container | Check |
|---|---|
| postgres | `pg_isready` |
| redis | `redis-cli ping` |
| api | image `HEALTHCHECK`: `GET http://127.0.0.1:8787/healthz` |
| worker | disabled (no HTTP listener) |
| web | `GET /` on nginx |
| redpanda | `rpk cluster health` |

Check status with `docker compose ps`.

## Logs

- nginx access log is JSON on stdout (`json_combined`):

| Field | Meaning |
|---|---|
| `request_id` | Same value sent as `X-Request-Id` to API |
| `remote_addr` | Client IP after real_ip |
| `status`, `request_time` | Edge outcome and latency |
| `upstream_addr`, `upstream_status`, `upstream_response_time` | Which API replica answered, and how long |
| `upstream_cache_status` | `HIT`, `MISS`, `STALE`, `UPDATING`, `BYPASS`, or `-` |

- API and worker log to stdout. Correlate with `request_id`.
- View: `docker compose logs -f web api worker`.

## Security notes

- Dev passwords in `docker-compose.yml`, `init.sql` and `.env.docker.example` are local-only. Rotate them and use managed secrets elsewhere.
- Only `web` publishes a port. The API, Postgres and Redis stay on the internal network.
- Containers run as non-root (`node`, `postgres`). App code is root-owned and read-only at runtime.
- `AUTH_SECRET` must be at least 32 characters. The API refuses to start in production otherwise.
