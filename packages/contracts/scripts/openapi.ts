import { writeFileSync } from "node:fs";
import { buildOpenApi } from "../src/openapi";

const out = new URL("../../../docs/openapi.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log(`wrote ${out.pathname}`);
