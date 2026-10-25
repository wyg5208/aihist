/**
 * Layered coverage check against the curated benchmark.
 *
 *   node scripts/check-coverage.mjs
 *   node scripts/check-coverage.mjs --exclude-slug turing-1950 --require-total 1 --no-report
 *
 * It drains the real sync pipeline into an in-memory database and measures the
 * resulting archive. The benchmark is a fixture: nothing here writes events.
 */
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BENCHMARK } from "./benchmark.mjs";
import {
  DEFAULT_THRESHOLDS,
  buildCoverage,
  formatCoverage,
} from "./coverage.mjs";
import { drainOffline } from "./lib/offline-sync.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const excludeSlug = optionValue("--exclude-slug");
const requireTotal = optionValue("--require-total");
const noReport = args.includes("--no-report");

if (requireTotal !== undefined) {
  const value = Number(requireTotal);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    console.error("--require-total must be a number between 0 and 1");
    process.exit(2);
  }
}

const { rows, runs } = await drainOffline();
const excluded = excludeSlug
  ? rows.filter((row) => row.slug === excludeSlug)
  : [];
if (excludeSlug && excluded.length === 0) {
  console.error(`--exclude-slug found no row with slug ${excludeSlug}`);
  process.exit(2);
}
const measured = excludeSlug
  ? rows.filter((row) => row.slug !== excludeSlug)
  : rows;

const thresholds = {
  ...DEFAULT_THRESHOLDS,
  ...(requireTotal !== undefined ? { total: Number(requireTotal) } : {}),
};

const report = buildCoverage(measured, { benchmark: BENCHMARK, thresholds });
const drained = runs.length > 0 && runs[runs.length - 1].result?.createdCount === 0;
if (!drained) {
  report.errors.push(`archive did not drain within ${runs.length} runs`);
  report.ok = false;
}

console.log(`runs           ${runs.length} · ${runs.map((run) => run.status).join(" → ")}`);
if (!drained) console.log("diagnostic     archive did not drain; coverage is partial");
if (excludeSlug) {
  console.log(`diagnostic     excluded ${excludeSlug} (${excluded.length} row)`);
}
if (requireTotal !== undefined) {
  console.log(`diagnostic     total threshold overridden to ${Number(requireTotal) * 100}%`);
}
console.log(formatCoverage(report));

if (report.errors.length) {
  console.log("");
  for (const error of report.errors) console.error(`FAIL ${error}`);
}

if (!noReport) {
  const file = join(PROJECT_ROOT, "coverage-report.json");
  await writeFile(
    file,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "offline fixtures",
        runs: runs.map((run) => ({
          status: run.status,
          result: run.result,
        })),
        drained,
        excludedSlug: excludeSlug || null,
        report,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(`\nreport         ${file}`);
}

console.log(
  report.ok
    ? "\nCoverage check passed."
    : `\nCoverage check failed (${report.errors.length} issues).`
);
process.exitCode = report.ok ? 0 : 1;
