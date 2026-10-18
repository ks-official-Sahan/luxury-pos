import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export { schema };
export * from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
}

/**
 * One pool per process. Behind Neon/PgBouncer use the pooled URL; statements are
 * plain parameterised queries, safe for transaction pooling.
 */
export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}

/**
 * Runs `fn` in a transaction whose row-level-security context is `tenantId`.
 * `set_config(..., true)` is transaction-local, so a pooled connection never
 * leaks one tenant's context to the next request.
 */
export function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/** For trusted cross-tenant paths only: token lookup, sign-up, the outbox worker. */
export function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}

/** Idempotent RLS policies for every tenant table. FORCE makes the table owner obey them too. */
export function rlsSql(): string {
  return schema.TENANT_TABLES.map(
    (table) => `alter table "${table}" enable row level security;
alter table "${table}" force row level security;
drop policy if exists tenant_isolation on "${table}";
create policy tenant_isolation on "${table}"
  using (current_setting('app.bypass_rls', true) = 'on' or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (current_setting('app.bypass_rls', true) = 'on' or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);`,
  ).join("\n\n");
}
