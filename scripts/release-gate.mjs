/**
 * Release gate for the whole repository.
 *
 *   node scripts/release-gate.mjs                  run every gate, stop at the first red one
 *   node scripts/release-gate.mjs --from G3        resume from a step
 *   node scripts/release-gate.mjs --skip G5        skip a step (never on a real release)
 *   node scripts/release-gate.mjs --list           show the step ids
 *
 * A red gate means the release stops here. `--skip` exists so that day-to-day
 * checks can drop the slow coverage drain; a public release runs all of it, and
 * anything skipped has to be explained in the iteration record.
 *
 * Exit codes: 0 all green, 1 a gate failed, 2 the gate could not be run
 * (missing interpreter, unknown step id).
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BACKEND = join(ROOT, "backend");

function backendPython() {
  const candidates =
    process.platform === "win32"
      ? [join(BACKEND, ".venv", "Scripts", "python.exe")]
      : [join(BACKEND, ".venv", "bin", "python")];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

const STEPS = [
  {
    id: "G0",
    name: "version consistency",
    run: [process.execPath, ["scripts/check-version.mjs"]],
    cwd: ROOT,
  },
  {
    id: "G1",
    name: "build (tsc + vite + static pages)",
    run: ["npm", ["run", "build"]],
    cwd: ROOT,
  },
  {
    id: "G2",
    name: "static pages, sitemap, robots",
    run: ["npm", ["run", "check:pages"]],
    cwd: ROOT,
  },
  {
    id: "G3",
    name: "ingest pipeline",
    run: ["npm", ["run", "check:pipeline"]],
    cwd: ROOT,
  },
  {
    id: "G4",
    name: "editorial gate",
    run: ["npm", ["run", "check:editorial"]],
    cwd: ROOT,
  },
  {
    id: "G5",
    name: "benchmark coverage",
    run: ["npm", ["run", "check:coverage"]],
    cwd: ROOT,
  },
  {
    id: "G6",
    name: "backend tests (pytest)",
    run: () => {
      const python = backendPython();
      if (!python) return null;
      return [python, ["-m", "pytest", "-q"]];
    },
    cwd: BACKEND,
  },
];

const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (args.includes("--list") || args.includes("-l")) {
  for (const step of STEPS) console.log(`${step.id}  ${step.name}`);
  process.exit(0);
}

const known = new Set(STEPS.map((step) => step.id));
const skip = new Set(
  (optionValue("--skip") || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
);
const from = (optionValue("--from") || "").trim().toUpperCase();

for (const id of skip) {
  if (!known.has(id)) {
    console.error(`--skip ${id}: unknown step. Use --list to see the ids.`);
    process.exit(2);
  }
}
if (from && !known.has(from)) {
  console.error(`--from ${from}: unknown step. Use --list to see the ids.`);
  process.exit(2);
}

if (process.env.SITE_ORIGIN) {
  console.log(`SITE_ORIGIN=${process.env.SITE_ORIGIN}`);
} else {
  console.log("SITE_ORIGIN is not set: the build will use the default origin from site.config.mjs.");
  console.log("For a release, set it to the domain that will actually serve the site.\n");
}

const selected = STEPS.filter((step) => {
  if (from && STEPS.indexOf(step) < STEPS.findIndex((item) => item.id === from)) return false;
  return !skip.has(step.id);
});

if (selected.length === 0) {
  console.error("Nothing to run: every step was skipped.");
  process.exit(2);
}

const results = [];
let red = false;
const startedAll = Date.now();

for (const step of selected) {
  if (red) {
    results.push({ id: step.id, name: step.name, status: "skipped (earlier gate failed)", seconds: 0 });
    continue;
  }

  const command = typeof step.run === "function" ? step.run() : step.run;
  if (!command) {
    console.error(`\n[${step.id}] ${step.name}`);
    console.error(
      `FAIL backend interpreter not found. Create it with: python -m venv backend\\.venv && backend\\.venv\\Scripts\\python.exe -m pip install -e backend[dev]`
    );
    results.push({ id: step.id, name: step.name, status: "environment error", seconds: 0 });
    red = true;
    continue;
  }

  const [file, argv] = command;
  const label = [file.includes(" ") ? `"${file}"` : file, ...argv].join(" ");
  console.log(`\n[${step.id}] ${step.name}`);
  console.log(`     ${label}`);

  const started = Date.now();
  const outcome = spawnSync(label, { cwd: step.cwd, stdio: "inherit", shell: true });
  const seconds = (Date.now() - started) / 1000;

  if (outcome.error) {
    console.error(`FAIL ${outcome.error.message}`);
    results.push({ id: step.id, name: step.name, status: "environment error", seconds });
    red = true;
    continue;
  }
  if (outcome.status !== 0) {
    results.push({ id: step.id, name: step.name, status: `failed (exit ${outcome.status})`, seconds });
    red = true;
    continue;
  }
  results.push({ id: step.id, name: step.name, status: "ok", seconds });
}

console.log("\nrelease gate summary");
for (const result of results) {
  const seconds = result.seconds ? `${result.seconds.toFixed(1)}s` : "-";
  console.log(`  ${result.id}  ${result.status.padEnd(28)} ${seconds.padStart(6)}  ${result.name}`);
}
console.log(`  total ${((Date.now() - startedAll) / 1000).toFixed(1)}s`);

if (red) {
  console.error("\nRelease gate failed. Do not publish: fix the red gate above and run it again.");
  process.exitCode = 1;
} else {
  console.log("\nRelease gate passed.");
  process.exitCode = 0;
}
