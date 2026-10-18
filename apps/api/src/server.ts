import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadEnv } from "./env";
import { createInfra } from "./infra";

const infra = createInfra(loadEnv());
const auth = await createAuth(infra);
const app = createApp(infra, auth);

const server = serve({ fetch: app.fetch, port: infra.env.PORT }, (info) => console.log(`[api] listening on :${info.port}`));

// Graceful shutdown: stop accepting, let in-flight requests finish, then close the pool.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void infra.pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
