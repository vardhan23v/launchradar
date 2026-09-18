import { CONFIG } from "../config";
import { makeId } from "../serpapi/client";
import type { Store } from "../store";
import { startDemoRun } from "./demo";
import { runLivePipeline } from "./live";

export interface StartRunInput {
  question: string;
  region: string;
  demoSlug?: string | null;
}

export interface StartRunResult {
  runId: string;
  mode: "demo" | "live" | "failed";
}

/**
 * Create a run and kick it off.
 *  - demoSlug → recorded run materialised instantly (SSE replays its research trace)
 *  - otherwise → live pipeline on the configured SerpApi key + LLM (async, non-blocking)
 */
export function startRun(store: Store, input: StartRunInput): StartRunResult {
  const { question, region, demoSlug } = input;

  if (demoSlug) {
    const runId = startDemoRun(store, demoSlug);
    return { runId, mode: "demo" };
  }

  const runId = makeId("run");
  const canLive = CONFIG.effectiveMode() === "live";
  store.createRun({
    id: runId,
    question,
    region,
    questionType: null,
    status: "running",
    budget: CONFIG.runSearchBudget,
    searchesUsed: 0,
    createdAt: Date.now(),
    finishedAt: null,
    demo: false,
    demoLabel: null,
    rejectedSignals: 0,
    error: null,
  });

  if (canLive) {
    // fire-and-forget; the SSE stream surfaces progress
    void (async () => {
      await runLivePipeline(store, runId, question, region);
    })();
  } else {
    // no key configured — fail the run fast with guidance instead of hanging
    store.updateRun(runId, {
      status: "failed",
      error:
        "No SERPAPI_API_KEY / LLM key configured. Run in SERPAPI_MODE=replay with recorded fixtures, or load a demo run.",
      finishedAt: Date.now(),
    });
  }

  return { runId, mode: canLive ? "live" : "failed" };
}