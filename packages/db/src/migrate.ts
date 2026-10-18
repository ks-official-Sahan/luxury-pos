import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, rlsSql } from "./index";

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const { db, pool } = createDb(url, { max: 1 });
await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
await pool.query(rlsSql());
await pool.end();
console.log("migrations and RLS policies applied");
