import { defineConfig } from "vitest/config";

export default defineConfig({
  // ai-core and media-kit guard their server modules with `server-only`; Node needs the react-server condition.
  resolve: { conditions: ["react-server"] },
  ssr: { resolve: { conditions: ["react-server"], externalConditions: ["react-server"] } },
  test: { include: ["src/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000, server: { deps: { inline: [/@sahan-sac/] } } },
});
