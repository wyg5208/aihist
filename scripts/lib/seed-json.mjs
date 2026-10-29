import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The frozen seed catalogue now lives in the backend tree: it is the single
 * source of truth loaded into the database by `python -m app.cli seed`. The static
 * pages are generated from the same file so a build can never drift from the
 * data the API serves.
 */
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const SEED_FILE = join(ROOT, "backend", "app", "data", "seed.json");

const parsed = JSON.parse(readFileSync(SEED_FILE, "utf8"));

if (!Array.isArray(parsed.events) || parsed.events.length === 0) {
  throw new Error(`${SEED_FILE} contains no events`);
}
if (typeof parsed.count === "number" && parsed.count !== parsed.events.length) {
  throw new Error(
    `${SEED_FILE} claims ${parsed.count} events but holds ${parsed.events.length}`
  );
}

export const SEED_VERSION = String(parsed.seedVersion ?? "unknown");
export const SEED_DIGEST = String(parsed.seedDigest ?? "");
export const SEED_STAMP = SEED_DIGEST ? `${SEED_VERSION}#${SEED_DIGEST}` : SEED_VERSION;
export const SEED_EVENTS = parsed.events;
