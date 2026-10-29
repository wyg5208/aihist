/**
 * Version consistency gate (G0).
 *
 *   node scripts/check-version.mjs
 *
 * This repository carries four version families and they must not be conflated:
 *
 *   1. product version  package.json <- source of truth, mirrored by
 *                       backend/pyproject.toml and the "当前版本" line in README.md
 *   2. rule version     RUBRIC_VERSION, declared once in the Python backend and
 *                       once in the JavaScript reference implementation
 *   3. data version     SEED_VERSION in functions/lib/seed.mjs, frozen into
 *                       backend/app/data/seed.json by scripts/export-seed.mjs
 *   4. contract fixtures backend/tests/fixtures/golden/*.json
 *
 * Product-version drift fails the gate (exit 1). Rule/data drift is reported as
 * WARN and does not change the exit code: fixing it is a deliberate change
 * (bump the rubric, re-export the golden files), not a mechanical rewrite. Every
 * WARN must be explained in the iteration record.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SEMVER = /^\d+\.\d+\.\d+$/;

async function read(relative) {
  return readFile(join(ROOT, relative), "utf8");
}

function firstMatch(source, pattern) {
  const found = source.match(pattern);
  return found ? found[1].trim() : null;
}

function row(label, value, status) {
  const text = value === null || value === undefined ? "(not found)" : String(value);
  const suffix = status && status !== "ok" ? `  ${status}` : "";
  console.log(`${label.padEnd(34)} ${text.padEnd(16)}${suffix}`);
}

const failures = [];
const warnings = [];

// --- product version: one value mirrored in three files ----------------------

const pkg = JSON.parse(await read("package.json"));
const productVersion = String(pkg.version || "").trim();

const pyproject = await read("backend/pyproject.toml");
const pyprojectVersion = firstMatch(pyproject, /^version\s*=\s*"([^"]+)"/m);

const readme = await read("README.md");
const readmeVersion = firstMatch(readme, /\*\*当前版本\*\*[：:]\s*v?(\d+\.\d+\.\d+)/);

if (!SEMVER.test(productVersion)) failures.push(`package.json version is not X.Y.Z: "${productVersion}"`);

for (const [label, value, fix] of [
  ["backend/pyproject.toml", pyprojectVersion, 'set [project] version = "%s"'],
  ["README.md (当前版本)", readmeVersion, 'add or fix "> **当前版本**：v%s"'],
]) {
  if (value === null) failures.push(`${label}: version not found; ${fix.replace("%s", productVersion)}`);
  else if (value !== productVersion) {
    failures.push(`${label} is ${value}, package.json is ${productVersion}; ${fix.replace("%s", productVersion)}`);
  }
}

const productOk = failures.length === 0;
console.log(`product version ${productVersion || "(missing)"}\n`);
row("package.json", productVersion, productOk ? "ok" : "FAIL");
row("backend/pyproject.toml", pyprojectVersion, pyprojectVersion === productVersion ? "ok" : "FAIL");
row("README.md (current version)", readmeVersion, readmeVersion === productVersion ? "ok" : "FAIL");

// --- rule version: two implementations, one vocabulary ----------------------

const rulesPy = await read("backend/app/editorial/rules.py");
const rulesJs = await read("functions/lib/editorial.mjs");

const pyRule = {
  rubric: firstMatch(rulesPy, /^RUBRIC_VERSION\s*=\s*"([^"]+)"/m),
  panel: firstMatch(rulesPy, /^PANEL_SIZE\s*=\s*(\d+)/m),
  votes: firstMatch(rulesPy, /^MIN_INCLUDE_VOTES\s*=\s*(\d+)/m),
  score: firstMatch(rulesPy, /^INCLUDE_SCORE\s*=\s*(\d+)/m),
};
const jsRule = {
  rubric: firstMatch(rulesJs, /export const RUBRIC_VERSION\s*=\s*"([^"]+)"/),
  panel: firstMatch(rulesJs, /export const PANEL_SIZE\s*=\s*(\d+)/),
  score: firstMatch(rulesJs, /export const INCLUDE_SCORE\s*=\s*(\d+)/),
};

console.log("\nrule and data versions (reported, not gated)");
row("RUBRIC_VERSION (python)", pyRule.rubric);
row("RUBRIC_VERSION (js)", jsRule.rubric, pyRule.rubric === jsRule.rubric ? "ok" : "WARN drift");
row("PANEL_SIZE (python)", pyRule.panel);
row("PANEL_SIZE (js)", jsRule.panel, pyRule.panel === jsRule.panel ? "ok" : "WARN drift");
row("MIN_INCLUDE_VOTES (python)", pyRule.votes);
row("INCLUDE_SCORE (python/js)", `${pyRule.score ?? "?"}/${jsRule.score ?? "?"}`,
  pyRule.score === jsRule.score ? "ok" : "WARN drift");

if (pyRule.rubric !== jsRule.rubric) warnings.push("RUBRIC_VERSION drifts between the Python backend and the JS reference implementation");
if (pyRule.panel !== jsRule.panel) warnings.push("PANEL_SIZE drifts between the Python backend and the JS reference implementation");

// --- seed data version and its frozen copy ----------------------------------

const seedModule = await import("../functions/lib/seed.mjs");
const seedVersionJs = seedModule.SEED_VERSION;
const seedDigestJs = seedModule.SEED_DIGEST;
const seedJson = JSON.parse(await read("backend/app/data/seed.json"));
const seedVersionJson = String(seedJson.seedVersion ?? "");
const seedDigestJson = String(seedJson.seedDigest ?? "");
row("SEED_VERSION (functions/lib/seed.mjs)", seedVersionJs);
row(
  "seedVersion (app/data/seed.json)",
  seedVersionJson,
  seedVersionJs === seedVersionJson ? "ok" : "WARN stale"
);
row(
  "seed digest (js / frozen)",
  `${seedDigestJs} / ${seedDigestJson}`,
  seedDigestJs === seedDigestJson ? "ok" : "WARN stale"
);
if (seedVersionJs !== seedVersionJson || seedDigestJs !== seedDigestJson) {
  warnings.push("backend/app/data/seed.json is stale: run node scripts/export-seed.mjs and the backend tests");
}

// --- the FastAPI app version must be derived, not hand-written ----------------

const mainPy = await read("backend/app/main.py");
const derivedVersion = /package_version\(\s*"([^"]+)"\s*\)/.test(mainPy);
const literalVersion = firstMatch(mainPy, /FastAPI\([\s\S]{0,400}?version="([^"]+)"/);
row(
  "FastAPI(version=) in app/main.py",
  derivedVersion ? "pyproject (importlib)" : literalVersion,
  derivedVersion ? "ok" : "WARN duplicate"
);
if (!derivedVersion) {
  warnings.push(
    "backend/app/main.py declares a literal version; read it from the installed distribution so it cannot drift"
  );
}

// --- golden fixtures age -----------------------------------------------------

try {
  const golden = JSON.parse(await read("backend/tests/fixtures/golden/editorial.json"));
  row("golden/editorial.json exportedAt", golden.exportedAt);
} catch {
  warnings.push("backend/tests/fixtures/golden/editorial.json is missing or unreadable");
}

// --- verdict ----------------------------------------------------------------

console.log("");
if (warnings.length) {
  for (const warning of warnings) console.log(`WARN ${warning}`);
  console.log("WARN rule/data drift does not fail this gate; explain every WARN in the iteration record.");
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`\nVersion check failed (${failures.length} issue).`);
  process.exitCode = 1;
} else {
  console.log("\nVersion check passed.");
  process.exitCode = 0;
}
