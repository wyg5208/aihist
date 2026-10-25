import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { serveSite } from "./adapter.mjs";
import { handleApp } from "./handler.mjs";

type WaitUntil = (promise: Promise<unknown>) => void;

function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
}

function runtimeForRequest() {
  const edge = (globalThis as { EdgeRuntime?: { waitUntil?: WaitUntil } }).EdgeRuntime;
  const waitUntil =
    typeof edge?.waitUntil === "function"
      ? (promise: Promise<unknown>) => edge.waitUntil!(promise)
      : null;
  return {
    waitUntil,
    env: {
      LLM_API_BASE: readEnv("LLM_API_BASE"),
      LLM_API_KEY: readEnv("LLM_API_KEY"),
      LLM_MODEL: readEnv("LLM_MODEL"),
      EDITORIAL_JUDGE_BASE: readEnv("EDITORIAL_JUDGE_BASE"),
      EDITORIAL_JUDGE_KEY: readEnv("EDITORIAL_JUDGE_KEY"),
      EDITORIAL_JUDGE_MODELS: readEnv("EDITORIAL_JUDGE_MODELS"),
      EDITORIAL_JUDGE_TIMEOUT_MS: readEnv("EDITORIAL_JUDGE_TIMEOUT_MS"),
      EDITORIAL_JUDGE_1_MODEL: readEnv("EDITORIAL_JUDGE_1_MODEL"),
      EDITORIAL_JUDGE_1_BASE: readEnv("EDITORIAL_JUDGE_1_BASE"),
      EDITORIAL_JUDGE_1_KEY: readEnv("EDITORIAL_JUDGE_1_KEY"),
      EDITORIAL_JUDGE_2_MODEL: readEnv("EDITORIAL_JUDGE_2_MODEL"),
      EDITORIAL_JUDGE_2_BASE: readEnv("EDITORIAL_JUDGE_2_BASE"),
      EDITORIAL_JUDGE_2_KEY: readEnv("EDITORIAL_JUDGE_2_KEY"),
      EDITORIAL_JUDGE_3_MODEL: readEnv("EDITORIAL_JUDGE_3_MODEL"),
      EDITORIAL_JUDGE_3_BASE: readEnv("EDITORIAL_JUDGE_3_BASE"),
      EDITORIAL_JUDGE_3_KEY: readEnv("EDITORIAL_JUDGE_3_KEY"),
    },
  };
}

Deno.serve(
  serveSite(
    ({ request, supabase }) => handleApp({ request, supabase, runtime: runtimeForRequest() }),
    {
      createClient,
      env: (name: string) => Deno.env.get(name),
    }
  )
);
