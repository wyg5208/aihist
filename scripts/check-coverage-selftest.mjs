/**
 * Self-test for the coverage checker: prove the numbers move when an archive
 * entry disappears, and prove the CLI exits non-zero when a threshold fails.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BENCHMARK } from "./benchmark.mjs";
import {
  DEFAULT_THRESHOLDS,
  buildCoverage,
  matchBenchmark,
  validateBenchmark,
} from "./coverage.mjs";
import { drainOffline } from "./lib/offline-sync.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const { rows } = await drainOffline();
const baseline = buildCoverage(rows, { benchmark: BENCHMARK });

check(
  "baseline passes every threshold",
  baseline.ok,
  baseline.errors[0] || `${baseline.total.matched}/${baseline.total.expected}`
);
check(
  "baseline reports concrete gaps",
  baseline.gaps.length >= 3,
  `${baseline.gaps.length} gaps`
);
check(
  "every gap can become a seed task",
  baseline.gaps.every((gap) => gap.id && gap.year && gap.note),
  baseline.gaps.map((gap) => gap.id).join(", ")
);
check(
  "high-importance seeds are represented",
  baseline.highImportanceSeeds.missing.length === 0,
  `${baseline.highImportanceSeeds.expected} seeds`
);

const matched = matchBenchmark(rows, BENCHMARK);
const matchedRowIds = [...matched.values()].map((item) => item.rowId);
check(
  "each benchmark entry maps to a distinct archive row",
  new Set(matchedRowIds).size === matchedRowIds.length,
  `${matchedRowIds.length} rows`
);
check(
  "every match records its basis for audit",
  baseline.matchedEntries.every(
    (entry) =>
      entry.rowId &&
      ["model-key", "phrase", "tokens"].includes(entry.kind)
  ),
  `${baseline.matchedEntries.length} matches`
);
check(
  "benchmark validator rejects duplicate ids",
  validateBenchmark([...BENCHMARK, BENCHMARK[0]]).some((error) =>
    error.includes("duplicate")
  )
);
check(
  "benchmark validator rejects entries without a matcher",
  validateBenchmark([
    { ...BENCHMARK[0], tokens: [], keys: [], phrase: "" },
  ]).some((error) => error.includes("no usable matcher"))
);

const turingRow = rows.find((row) => row.slug === "turing-1950");
check("turing row exists in the fixture archive", Boolean(turingRow));
if (turingRow) {
  const reduced = buildCoverage(
    rows.filter((row) => row !== turingRow),
    { benchmark: BENCHMARK }
  );
  const before1950s = baseline.decades.find((item) => item.key === "1950s");
  const after1950s = reduced.decades.find((item) => item.key === "1950s");

  check(
    "removing one seed drops exactly one match",
    reduced.total.matched === baseline.total.matched - 1,
    `${baseline.total.matched} → ${reduced.total.matched}`
  );
  check(
    "the removed entry becomes a gap",
    reduced.gaps.some((gap) => gap.id === "turing-1950")
  );
  check(
    "the affected decade rate falls",
    Boolean(before1950s && after1950s) &&
      after1950s.rate < before1950s.rate,
    before1950s && after1950s
      ? `${(before1950s.rate * 100).toFixed(1)}% → ${(after1950s.rate * 100).toFixed(1)}%`
      : "1950s bucket missing"
  );
  check(
    "a stricter total threshold fails",
    !buildCoverage(rows.filter((row) => row !== turingRow), {
      benchmark: BENCHMARK,
      thresholds: { ...DEFAULT_THRESHOLDS, total: 1 },
    }).ok
  );
}

const cli = spawnSync(
  process.execPath,
  [
    "scripts/check-coverage.mjs",
    "--exclude-slug",
    "turing-1950",
    "--require-total",
    "1",
    "--no-report",
  ],
  { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 120000 }
);
check(
  "CLI exits non-zero when the total threshold fails",
  cli.status === 1,
  cli.error ? cli.error.message : `status ${cli.status}`
);
check(
  "CLI explains the failure",
  /below 100\.0%|Coverage check failed/.test(`${cli.stdout}${cli.stderr}`)
);

console.log(
  failures
    ? `\nCoverage self-test failed (${failures} issues).`
    : "\nCoverage self-test passed."
);
process.exitCode = failures ? 1 : 0;
