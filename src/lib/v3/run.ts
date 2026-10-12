/**
 * Run-page helpers: the pipeline's stages, engine names for the research log, and what the event
 * log says about a run's health (how many searches failed, why, and whether the run ended with
 * limited evidence). Pure functions only.
 */

import type { Run, RunOutcome, RunView, StepEvent } from "@/lib/types";

export interface StageDef {
  id: string;
  label: string;
  /** stage keys the API emits for this step */
  keys: string[];
}

export const PIPELINE: StageDef[] = [
  { id: "plan", label: "Pick lookups", keys: ["planner", "autocomplete-seed"] },
  { id: "discover", label: "Look around the web", keys: ["discovery"] },
  { id: "extract", label: "Find complaints", keys: ["signals", "extract"] },
  { id: "cluster", label: "Group them", keys: ["cluster", "trends"] },
  { id: "competitors", label: "Find existing products", keys: ["competitors"] },
  { id: "verify", label: "Check if anyone solves it", keys: ["gaps", "verify"] },
  { id: "score", label: "Score the ideas", keys: ["score", "opportunity", "skeptic", "done"] },
];

export const stageIndex = (key: string): number => PIPELINE.findIndex((p) => p.keys.includes(key));

/** The plain label of a pipeline step by its id ("plan", "score", ...). */
export const stageLabel = (id: string): string => PIPELINE.find((p) => p.id === id)?.label ?? id;

export function stageOf(e: StepEvent): string | null {
  if (e.type === "stage" || e.type === "llm") return e.stage;
  if (e.type === "search_call") return e.call.stage;
  return null;
}

/** Where one lookup went, in the names people know. */
const ENGINE_LABEL: Record<string, string> = {
  google: "Google search",
  google_news: "Google News",
  google_autocomplete: "search suggestions",
  google_trends: "Google Trends",
  google_maps: "Google Maps",
  google_maps_reviews: "Google Maps reviews",
  google_play_product: "Play Store",
  apple_reviews: "App Store",
  google_shopping: "Google Shopping",
  google_jobs: "Google Jobs",
  youtube: "YouTube",
};

export const engineLabel = (engine: string): string => ENGINE_LABEL[engine] ?? engine.replace(/_/g, " ");

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const RUN_STATUSES = ["queued", "running", "complete", "failed"];
const CALL_STATUSES = ["ok", "failed", "skipped"];
const LEVELS = ["info", "ok", "warn", "error"];

/**
 * A frame from the event stream, checked field by field before the page trusts it. Anything else
 * (a truncated frame, a shape from a newer server) is dropped rather than rendered.
 */
export function parseStepEvent(raw: unknown): StepEvent | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(v) || typeof v.type !== "string") return null;
  switch (v.type) {
    case "stage":
      if (typeof v.stage !== "string" || typeof v.message !== "string") return null;
      return { type: "stage", stage: v.stage, message: v.message, level: LEVELS.includes(v.level as string) ? (v.level as "info" | "ok" | "warn" | "error") : "info" };
    case "search_call": {
      const c = v.call;
      if (!isObj(c) || typeof c.stage !== "string" || typeof c.engine !== "string") return null;
      return {
        type: "search_call",
        call: {
          stage: c.stage,
          engine: c.engine,
          query: typeof c.query === "string" ? c.query : "",
          resultCount: typeof c.resultCount === "number" ? c.resultCount : 0,
          cached: c.cached === true,
          latencyMs: typeof c.latencyMs === "number" ? c.latencyMs : 0,
          status: CALL_STATUSES.includes(c.status as string) ? (c.status as "ok" | "failed" | "skipped") : "ok",
        },
      };
    }
    case "llm":
      if (typeof v.stage !== "string") return null;
      return { type: "llm", stage: v.stage, model: typeof v.model === "string" ? v.model : "", description: typeof v.description === "string" ? v.description : "" };
    case "status":
      return RUN_STATUSES.includes(v.status as string) ? { type: "status", status: v.status as Run["status"] } : null;
    case "done":
      return { type: "done", runId: typeof v.runId === "string" ? v.runId : "", searchesUsed: typeof v.searchesUsed === "number" ? v.searchesUsed : 0 };
    default:
      return null;
  }
}

export interface SearchStats {
  /** every search the run made, failed ones included */
  total: number;
  failed: number;
  /** why lookups didn't work, one line each, in the words the step log used ("The web lookup took too long") */
  reasons: string[];
  /** per pipeline stage: how many searches it made and how many of those failed */
  byStage: { total: number; failed: number }[];
}

/**
 * Counts searches from the event log, and takes the failure reasons from the warning the API
 * writes right after a failed search. `run.searchCalls` / `run.failedSearches` (newer servers)
 * win over the log when they are present, so the summary agrees with the server.
 */
export function searchStats(events: StepEvent[], run?: Run): SearchStats {
  const byStage = PIPELINE.map(() => ({ total: 0, failed: 0 }));
  let total = 0;
  let failed = 0;
  const reasons = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || e.type !== "search_call") continue;
    total += 1;
    const s = stageIndex(e.call.stage);
    if (s >= 0) byStage[s].total += 1;
    if (e.call.status !== "failed") continue;
    failed += 1;
    if (s >= 0) byStage[s].failed += 1;
    const next = events[i + 1];
    const why = next && next.type === "stage" && next.level === "warn" ? next.message.trim() : "The lookup didn't work";
    reasons.set(why, (reasons.get(why) ?? 0) + 1);
  }
  const sorted = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([why, n]) => (n > 1 ? `${why} (${n} times)` : why));
  // while the run streams, the log the page has received is what the reader can see, so the
  // summary counts that; once the run is finished the server's own totals are the word
  const finished = run?.status === "complete" || run?.status === "failed";
  return {
    total: finished && typeof run?.searchCalls === "number" ? run.searchCalls : total || run?.searchCalls || run?.searchesUsed || 0,
    failed: finished && typeof run?.failedSearches === "number" ? run.failedSearches : failed,
    reasons: sorted,
    byStage,
  };
}

/**
 * The run's outcome: the server's word when it gives one, otherwise read from the result.
 * Only finished runs have one.
 */
export function outcomeOf(view: RunView, stats: SearchStats): RunOutcome | null {
  const { run } = view;
  if (run.status !== "complete") return null;
  if (run.outcome === "full" || run.outcome === "limited" || run.outcome === "empty") return run.outcome;
  if (view.opportunities.length === 0 && !view.gaps.some((g) => g.status === "served")) return "empty";
  return stats.failed > 0 ? "limited" : "full";
}

/** True when a stage lost at least half of its searches: its tick becomes a warning mark. */
export const stageMostlyFailed = (s: { total: number; failed: number }): boolean => s.total > 0 && s.failed * 2 >= s.total;

/** Which stage a run is in, from the parts of the view that exist (for a list that has no event log). */
export function latestStageOf(view: RunView): string {
  if (view.opportunities.length > 0) return stageLabel("score");
  if (view.gaps.length > 0) return stageLabel("verify");
  if (view.competitors.length > 0) return stageLabel("competitors");
  if (view.clusters.length > 0) return stageLabel("cluster");
  if (view.signals.length > 0) return stageLabel("extract");
  const calls = Array.isArray(view.searchCalls) ? view.searchCalls : [];
  const last = calls[calls.length - 1];
  const key = isObj(last) && typeof last.stage === "string" ? last.stage : null;
  const i = key ? stageIndex(key) : -1;
  if (i >= 0) return PIPELINE[i].label;
  return calls.length > 0 || view.evidence.length > 0 ? stageLabel("discover") : stageLabel("plan");
}
