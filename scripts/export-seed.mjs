/**
 * Freeze the curated timeline into `backend/app/data/seed.json`.
 *
 * The Python backend and the static-page builder must read the same bytes, so
 * this file is generated once and committed. Fields are already final here:
 * tags, fingerprint, summary and evidence were computed by seed.mjs at import
 * time, and re-deriving them in Python would risk drift.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_DIGEST, SEED_EVENTS, SEED_VERSION } from "../functions/lib/seed.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(ROOT, "backend", "app", "data", "seed.json");

const payload = {
  seedVersion: SEED_VERSION,
  seedDigest: SEED_DIGEST,
  count: SEED_EVENTS.length,
  events: SEED_EVENTS,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const slugs = new Set(SEED_EVENTS.map((event) => event.seedId));
console.log(`seed.json written: ${SEED_EVENTS.length} events, ${slugs.size} unique ids, version ${SEED_VERSION}#${SEED_DIGEST}`);
if (slugs.size !== SEED_EVENTS.length) {
  console.error("duplicate seed ids detected");
  process.exitCode = 1;
}
