import { runSync } from "../../functions/lib/pipeline.mjs";
import { fixtureFetch } from "../../dev/fixture-fetch.mjs";
import { createFakeSupabase } from "../../dev/fake-supabase.mjs";

/**
 * Drain the real pipeline against recorded upstream payloads and an in-memory
 * database. Returns the final event rows, never touches a hosted database.
 */
export async function drainOffline({ maxRuns = 4 } = {}) {
  const supabase = createFakeSupabase();
  const runs = [];
  while (runs.length < maxRuns) {
    const run = await runSync({
      supabase,
      trigger: "manual",
      fetchImpl: fixtureFetch,
      // Coverage measures parsing and matching, not the editorial panel. The
      // same switch is used by scripts/check-pipeline.mjs.
      editorial: false,
    });
    runs.push(run);
    if (!run.result?.createdCount) break;
  }
  return { supabase, rows: supabase.tables.events, runs };
}
