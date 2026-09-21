/**
 * LaunchRadar redesign — view model layer.
 *
 * THIS IS THE ONLY FILE THAT KNOWS ABOUT YOUR DATA SHAPES.
 * Everything in `primitives.tsx`, `HomeClient.next.tsx` and `RunClient.next.tsx` talks to the
 * interfaces below and nothing else. If a field does not line up, fix it here and nowhere else.
 *
 * The mappers are deliberately tolerant: for every field they try a list of plausible keys (see
 * `ALIASES`) and fall back to a safe default. Nothing throws on unexpected input — a partial run
 * rendered as "unknown" is more useful than a crashed page.
 */

/* ------------------------------------------------------------------ view models */

/**
 * Stage ids are free-form: the host supplies its own pipeline. `src/lib/v2/adapter.ts` maps the
 * real Plan / Discover / Extract / Cluster / Competitors / Verify / Score stages onto this.
 */
export type StageId = string;
export type StageStatus = "pending" | "active" | "done" | "skipped" | "failed";

export interface StageVM {
  id: StageId;
  label: string;
  status: StageStatus;
  /** Why a stage was skipped or failed — shown to the user, never hidden. */
  detail?: string;
  searchesDone?: number;
  searchesPlanned?: number;
  durationMs?: number;
}

export interface EvidenceVM {
  id: string;
  /** Verbatim text from the source. Never paraphrased — that is the product's whole promise. */
  quote: string;
  url: string;
  domain: string;
  title?: string;
  /** The source's own publication date, when the result carried one. This is never a retrieval
   * timestamp: the backend only knows when the page was published, not when it was last checked. */
  sourceDate?: string;
}

export interface MetricVM {
  id: string;
  label: string;
  value: number;
  max: number;
  hint?: string;
}

export type ChangeVM = "new" | "up" | "down" | "dropped" | "same";

export interface GapVM {
  id: string;
  statement: string;
  filled: boolean;
  /** The backend's own tri-state: "open", "partially-served" or "served". "Partially served" is
   * deliberately distinct from "open" — a product already serves part of the need. */
  status: "open" | "partially-served" | "served";
  note?: string;
}

export interface OpportunityVM {
  id: string;
  name: string;
  oneLiner?: string;
  score: number;
  metrics: MetricVM[];
  evidence: EvidenceVM[];
  competitorCount?: number;
  gaps: GapVM[];
  /** Labelled prose carried over from the report view (problem, the case against, and so on). */
  detail?: { label: string; text: string }[];
  /** Populated by `diffRuns` (F8), not by the server. */
  change?: ChangeVM;
  delta?: number;
}

export interface CoverageVM {
  claims: number;
  sourced: number;
  discarded: number;
  gapsTested: number;
  gapsFilled: number;
}

export type RunStatus =
  | "queued" | "planning" | "searching" | "verifying" | "gaps"
  | "scoring" | "running" | "done" | "partial" | "failed";

export interface RunVM {
  id: string;
  question: string;
  region: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  budgetSeconds: number;
  searchesUsed: number;
  searchesCap: number;
  stages: StageVM[];
  opportunities: OpportunityVM[];
  /** Total row count when the full rows are not loaded (a run-list entry, not a run view). */
  opportunityCount?: number;
  coverage: CoverageVM;
  notes: string[];
  /** True when this run came from the recorded fixtures rather than live searches. */
  demo: boolean;
}

export type ThemeVM = "dark" | "light" | "system";
export type DensityVM = "comfortable" | "compact";

/* ------------------------------------------------------------------ constants */

export const STAGE_ORDER: StageId[] = ["plan", "search", "verify", "gaps", "score"];

export const STAGE_LABEL: Record<StageId, string> = {
  plan: "Plan searches",
  search: "Run searches",
  verify: "Verify quotes",
  gaps: "Test gaps",
  score: "Score",
};

/** Exactly the three regions the live site offers. Do not invent new ones. */
export const REGIONS = ["India", "United States", "United Kingdom"] as const;
export type Region = (typeof REGIONS)[number];

export const SEARCH_CAP = 25;
export const BUDGET_SECONDS = 270;
/* ------------------------------------------------------------------ small utils */

export type Rec = Record<string, unknown>;

export function asRec(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

export function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** First defined, non-null, non-empty-string value among `keys`. */
export function pick(rec: unknown, keys: readonly string[]): unknown {
  const r = asRec(rec);
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

export function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function bool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v !== 0;
  return fallback;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].replace(/^www\./, "") : "";
}

export function secondsBetween(a: number, b: number): number {
  return Math.max(0, Math.round((b - a) / 1000));
}

/** "3m 07s" — used by the stage rail and the budget ring. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/** Pure, locale-free relative time so SSR and client agree (no hydration mismatch). */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown time";
  const secs = Math.max(0, Math.round((nowMs - t) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}

export function scoreBand(score: number): "ok" | "warn" | "bad" {
  if (score >= 70) return "ok";
  if (score >= 40) return "warn";
  return "bad";
}

export function statusLabel(status: RunStatus): string {
  switch (status) {
    case "planning": return "Planning";
    case "searching": return "Searching";
    case "verifying": return "Verifying";
    case "gaps": return "Testing gaps";
    case "scoring": return "Scoring";
    case "done": return "Complete";
    case "partial": return "Finished early";
    case "failed": return "Failed";
    default: return "Running";
  }
}

/** Stable, dependency-free id — `crypto.randomUUID` is not guaranteed during SSR. */
export function makeId(prefix: string, seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}-${(h >>> 0).toString(36)}`;
}
/* ------------------------------------------------------------------ coercion
   Every alias list below is a guess. When your real payload differs, add the key here. */

export const ALIASES: Record<string, readonly string[]> = {
  runId: ["id", "run_id", "runId", "slug", "key"],
  question: ["question", "query", "market", "prompt", "input", "topic"],
  region: ["region", "country", "market_region", "geo", "locale"],
  runStatus: ["status", "state", "phase", "stage"],
  startedAt: ["started_at", "startedAt", "created_at", "createdAt", "created", "timestamp"],
  endedAt: ["ended_at", "endedAt", "finished_at", "completed_at", "completedAt"],
  budgetSeconds: ["budget_seconds", "budgetSeconds", "time_budget", "max_seconds", "deadline_seconds"],
  searchesUsed: ["searches_used", "searchesUsed", "searches_done", "search_count", "searches"],
  searchesCap: ["searches_cap", "searchesCap", "max_searches", "search_budget", "search_limit"],
  stages: ["stages", "steps", "phases", "progress"],
  opportunities: ["opportunities", "results", "findings", "ideas", "candidates"],
  coverage: ["coverage", "trust", "counts", "stats"],
  notes: ["notes", "warnings", "messages", "caveats", "limitations"],
  demo: ["demo", "is_demo", "recorded", "fixture", "mock"],

  oppName: ["name", "title", "label", "opportunity", "idea", "headline"],
  oppOneLiner: ["one_liner", "oneLiner", "summary", "thesis", "description", "pitch", "why"],
  oppScore: ["score", "total", "opportunity_score", "rank_score", "value"],
  oppMetrics: ["metrics", "breakdown", "subscores", "factors", "components", "scores"],
  oppEvidence: ["evidence", "sources", "citations", "quotes", "proofs", "references"],
  oppCompetitors: ["competitor_count", "competitorCount", "competitors", "competitor_total", "incumbents"],
  oppGaps: ["gaps", "gap_analysis", "unmet_needs", "unmetNeeds"],

  evQuote: ["quote", "text", "snippet", "exact_quote", "verbatim", "excerpt", "source_text"],
  evUrl: ["url", "link", "source_url", "href", "sourceUrl"],
  evDomain: ["domain", "host", "site", "source_domain", "source"],
  evTitle: ["title", "page_title", "heading", "source_title"],
  // a publication date the source itself carried — never treated as when we fetched it
  evDate: ["date", "published", "published_at", "source_date", "page_date"],

  metricValue: ["value", "score", "points", "weight", "count"],
  metricMax: ["max", "maximum", "out_of", "possible", "total"],

  covClaims: ["claims", "claim_count", "total_claims", "claims_total"],
  covSourced: ["sourced", "sourced_claims", "verified", "with_sources", "supported"],
  covDiscarded: ["discarded", "discarded_claims", "dropped", "rejected", "unsourced"],
  covGapsTested: ["gaps_tested", "gapsTested", "gaps_total", "gaps"],
  covGapsFilled: ["gaps_filled", "gapsFilled", "gaps_satisfied", "filled"],
};

const STAGE_ALIASES: Record<StageId, readonly string[]> = {
  plan: ["plan", "planning", "plan_searches", "planner", "queries"],
  search: ["search", "searching", "searches", "collect", "collection", "retrieve"],
  verify: ["verify", "verification", "verify_quotes", "validate", "validation", "extract"],
  gaps: ["gaps", "gap", "gap_check", "test_gaps", "competitor_check", "saturation"],
  score: ["score", "scoring", "rank", "ranking", "summarise", "summarize"],
};

/** Try to read a real field first, then the alias list, then the given default. */
export function read(rec: unknown, field: string, fallback: unknown): unknown {
  const direct = pick(rec, [field]);
  if (direct !== undefined) return direct;
  const keys = ALIASES[field];
  if (keys) {
    const v = pick(rec, keys);
    if (v !== undefined) return v;
  }
  return fallback;
}

export function normalizeStatus(raw: unknown): RunStatus {
  const s = str(raw).toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, RunStatus> = {
    queued: "queued", plan: "planning", planning: "planning", planned: "planning",
    search: "searching", searching: "searching", verify: "verifying", verifying: "verifying",
    gap: "gaps", gaps: "gaps", score: "scoring", scoring: "scoring",
    running: "running", in_progress: "running", done: "done", complete: "done",
    completed: "done", finished: "done", success: "done", succeeded: "done",
    partial: "partial", truncated: "partial", incomplete: "partial", timeout: "partial",
    failed: "failed", error: "failed", errored: "failed",
  };
  return map[s] ?? "done";
}

export function normalizeStageStatus(
  raw: unknown,
  index: number,
  activeIndex: number,
  aborted: boolean,
): StageStatus {
  const s = str(raw).toLowerCase();
  if (s === "done" || s === "complete" || s === "completed" || s === "ok") return "done";
  if (s === "active" || s === "running" || s === "in_progress") return "active";
  if (s === "skipped" || s === "skip") return "skipped";
  if (s === "failed" || s === "error") return "failed";
  if (index < activeIndex) return "done";
  if (index === activeIndex) return "active";
  return aborted ? "skipped" : "pending";
}
/* ------------------------------------------------------------------ element mappers */

function toEvidence(raw: unknown, i: number): EvidenceVM {
  const quote = str(read(raw, "evQuote", ""));
  const url = str(read(raw, "evUrl", ""));
  const domain = str(read(raw, "evDomain", "")) || hostOf(url);
  const title = str(read(raw, "evTitle", "")) || undefined;
  const sourceDate = str(read(raw, "evDate", "")) || undefined;
  return {
    id: makeId("ev", `${url}|${quote.slice(0, 40)}|${i}`),
    quote, url, domain, title, sourceDate,
  };
}

function toMetric(raw: unknown, i: number): MetricVM {
  const label = str(pick(raw, ["label", "name", "title", "key", "metric"]), `Metric ${i + 1}`);
  const value = num(read(raw, "metricValue", 0));
  const max = num(read(raw, "metricMax", 100)) || 100;
  const hint = str(pick(raw, ["hint", "note", "description", "help"])) || undefined;
  return { id: makeId("m", `${label}|${i}`), label, value, max, hint };
}

/**
 * Metrics arrive either as a list of objects or as a bare map such as `{ demand: 30, competition: 22 }`.
 * Both are supported, because which one your pipeline emits is unknown from here.
 */
function toMetrics(raw: unknown): MetricVM[] {
  if (Array.isArray(raw)) return raw.map(toMetric);
  const rec = asRec(raw);
  return Object.keys(rec).map((k, i) => ({
    id: makeId("m", `${k}|${i}`),
    label: k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    value: num(rec[k]),
    max: 100,
  }));
}

function toGap(raw: unknown, i: number): GapVM {
  if (typeof raw === "string") {
    return { id: makeId("gap", `${raw}|${i}`), statement: raw, filled: false, status: "open" };
  }
  const statement = str(pick(raw, ["statement", "gap", "text", "need", "claim", "title"]));
  const statusRaw = str(pick(raw, ["status", "state"]));
  const filled = bool(pick(raw, ["filled", "is_filled", "satisfied", "addressed", "closed"]));
  // "partially-served" is its own answer and must not collapse into "open" or "served"
  const status: GapVM["status"] =
    statusRaw === "served" || filled
      ? "served"
      : statusRaw === "partially-served" || statusRaw === "partial"
        ? "partially-served"
        : "open";
  const note = str(pick(raw, ["note", "reason", "evidence", "detail"])) || undefined;
  return { id: makeId("gap", `${statement}|${i}`), statement, filled, status, note };
}

function toOpportunity(raw: unknown, i: number): OpportunityVM {
  const name = str(read(raw, "oppName", ""), `Opportunity ${i + 1}`);
  const oneLiner = str(read(raw, "oppOneLiner", "")) || undefined;
  const score = clamp(num(read(raw, "oppScore", 0)), 0, 100);
  const metrics = toMetrics(read(raw, "oppMetrics", []));
  const evidence = asArr(read(raw, "oppEvidence", [])).map(toEvidence);
  const compRaw = read(raw, "oppCompetitors", undefined);
  const competitorCount = compRaw === undefined ? undefined : num(compRaw);
  const gaps = asArr(read(raw, "oppGaps", [])).map(toGap);
  const id = str(pick(raw, ["id", "slug", "opportunity_id"]), "") || makeId("op", `${name}|${i}`);
  return { id, name, oneLiner, score, metrics, evidence, competitorCount, gaps };
}

function toCoverage(raw: unknown, opps: OpportunityVM[]): CoverageVM {
  const evidenceCount = opps.reduce((n, o) => n + o.evidence.length, 0);
  const gapsFilled = opps.reduce((n, o) => n + o.gaps.filter((g) => g.filled).length, 0);
  const gapsTestedFallback = opps.reduce((n, o) => n + o.gaps.length, 0);
  const rec = asRec(raw);
  const hasAny = Object.keys(rec).length > 0;
  return {
    claims: num(read(rec, "covClaims", hasAny ? 0 : evidenceCount)),
    sourced: num(read(rec, "covSourced", hasAny ? 0 : evidenceCount)),
    discarded: num(read(rec, "covDiscarded", 0)),
    gapsTested: num(read(rec, "covGapsTested", gapsTestedFallback)),
    gapsFilled: num(read(rec, "covGapsFilled", gapsFilled)),
  };
}

function toStages(raw: unknown, activeStage: StageId | null, aborted: boolean): StageVM[] {
  const rec = asRec(raw);
  const activeIndex = activeStage ? STAGE_ORDER.indexOf(activeStage) : STAGE_ORDER.length;
  return STAGE_ORDER.map((id, index) => {
    // Explicit per-stage payload when you have one (e.g. `{ plan: { status: "done", ms: 900 } }`).
    const explicit = pick(rec, [id, ...STAGE_ALIASES[id]]);
    const explicitRec = asRec(explicit);
    const hasExplicitObject = Object.keys(explicitRec).length > 0;
    const status = hasExplicitObject || typeof explicit === "string"
      ? normalizeStageStatus(pick(explicitRec, ["status", "state"]), index, activeIndex, aborted)
      : normalizeStageStatus(undefined, index, activeIndex, aborted);
    const durationMs = num(pick(explicitRec, ["duration_ms", "durationMs", "ms", "took_ms"]), 0);
    const searchesDone = pick(explicitRec, ["searches_done", "searchesDone", "done", "count"]);
    const searchesPlanned = pick(explicitRec, ["searches_planned", "searchesPlanned", "planned", "total"]);
    const detail = str(pick(explicitRec, ["detail", "reason", "note", "message", "error"])) || undefined;
    const stage: StageVM = { id, label: STAGE_LABEL[id], status };
    if (detail) stage.detail = detail;
    if (durationMs > 0) stage.durationMs = durationMs;
    if (searchesDone !== undefined) stage.searchesDone = num(searchesDone);
    if (searchesPlanned !== undefined) stage.searchesPlanned = num(searchesPlanned);
    if (status === "skipped" && !stage.detail) stage.detail = "Skipped to fit the time budget";
    return stage;
  });
}
/* ------------------------------------------------------------------ run mapper */

export const STAGE_FOR_STATUS: Partial<Record<RunStatus, StageId>> = {
  planning: "plan",
  searching: "search",
  verifying: "verify",
  gaps: "gaps",
  scoring: "score",
};

export interface ToRunOptions {
  /** Force the run to be treated as a recorded demo (F11). */
  demo?: boolean;
  /** Fallback question/region when the payload has neither. */
  question?: string;
  region?: string;
  /** Injected clock so callers control determinism. */
  nowMs?: number;
}

/**
 * Turn one wire payload into a `RunVM`. Safe on partial and malformed input: the only thing that
 * can be "wrong" is a missing field, which becomes a documented default.
 */
export function toRunVM(raw: unknown, opts: ToRunOptions = {}): RunVM {
  const nowMs = opts.nowMs ?? Date.now();
  const status = normalizeStatus(read(raw, "runStatus", "done"));
  const aborted = status === "partial" || status === "failed";
  const opportunities = asArr(read(raw, "opportunities", [])).map(toOpportunity);
  const startedAt = str(read(raw, "startedAt", "")) || new Date(nowMs).toISOString();
  const endedAtRaw = str(read(raw, "endedAt", ""));
  const searchesUsed = num(read(raw, "searchesUsed", opportunities.length));
  const notesRaw = read(raw, "notes", []);
  const notes = asArr(notesRaw).length > 0
    ? asArr(notesRaw).map((n) => str(n)).filter(Boolean)
    : (str(notesRaw) ? [str(notesRaw)] : []);

  const run: RunVM = {
    id: str(read(raw, "runId", "")) || makeId("run", `${startedAt}|${str(opts.question)}`),
    question: str(read(raw, "question", "")) || (opts.question ?? "Untitled research question"),
    region: str(read(raw, "region", "")) || (opts.region ?? REGIONS[0]),
    status,
    startedAt,
    budgetSeconds: num(read(raw, "budgetSeconds", BUDGET_SECONDS), BUDGET_SECONDS),
    searchesUsed,
    searchesCap: num(read(raw, "searchesCap", SEARCH_CAP), SEARCH_CAP),
    stages: toStages(read(raw, "stages", {}), STAGE_FOR_STATUS[status] ?? null, aborted),
    opportunities,
    coverage: toCoverage(read(raw, "coverage", {}), opportunities),
    notes: aborted && notes.length === 0
      ? ["Searches stopped at the time budget, so this run is smaller than a full one."]
      : notes,
    demo: opts.demo ?? bool(read(raw, "demo", false)),
  };
  if (endedAtRaw) run.endedAt = endedAtRaw;
  return run;
}

/* ------------------------------------------------------------------ diffing (F8) */

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Annotate `current` with how each opportunity changed versus `prev`. Pure — returns a new run. */
export function diffRuns(prev: RunVM | undefined, current: RunVM): RunVM {
  if (!prev) {
    return {
      ...current,
      opportunities: current.opportunities.map((o) => ({ ...o, change: "new" as ChangeVM, delta: o.score })),
    };
  }
  const before = new Map(prev.opportunities.map((o) => [nameKey(o.name), o]));
  const seen = new Set<string>();
  const opportunities = current.opportunities.map((o) => {
    const key = nameKey(o.name);
    seen.add(key);
    const old = before.get(key);
    if (!old) return { ...o, change: "new" as ChangeVM, delta: o.score };
    const delta = o.score - old.score;
    const change: ChangeVM = delta > 2 ? "up" : delta < -2 ? "down" : "same";
    return { ...o, change, delta };
  });
  for (const old of prev.opportunities) {
    if (seen.has(nameKey(old.name))) continue;
    opportunities.push({ ...old, change: "dropped", delta: -old.score });
  }
  return { ...current, opportunities };
}

export interface ChangeSummary {
  added: number;
  up: number;
  down: number;
  dropped: number;
  unchanged: number;
}

export function summarizeChanges(run: RunVM): ChangeSummary {
  const out: ChangeSummary = { added: 0, up: 0, down: 0, dropped: 0, unchanged: 0 };
  for (const o of run.opportunities) {
    if (o.change === "new") out.added += 1;
    else if (o.change === "up") out.up += 1;
    else if (o.change === "down") out.down += 1;
    else if (o.change === "dropped") out.dropped += 1;
    else out.unchanged += 1;
  }
  return out;
}
/* ------------------------------------------------------------------ research log */

export interface LogEntryVM {
  id: string;
  kind: "stage" | "search" | "note";
  title: string;
  meta?: string;
  tone?: "ok" | "warn" | "bad";
}

/* ------------------------------------------------------------------ board helpers (F6/F7) */

export type SortKey = "score" | "name" | "newest" | "competition" | "evidence";
export type BoardFilter = {
  query: string;
  minScore: number;
  onlyShortlisted: boolean;
  onlyChanged: boolean;
};

export const EMPTY_FILTER: BoardFilter = {
  query: "", minScore: 0, onlyShortlisted: false, onlyChanged: false,
};

export function filterOpportunities(
  opps: OpportunityVM[],
  filter: BoardFilter,
  shortlisted: readonly string[],
): OpportunityVM[] {
  const q = filter.query.trim().toLowerCase();
  const saved = new Set(shortlisted);
  return opps.filter((o) => {
    if (o.score < filter.minScore) return false;
    if (filter.onlyShortlisted && !saved.has(o.id)) return false;
    if (filter.onlyChanged && (o.change === undefined || o.change === "same")) return false;
    if (!q) return true;
    const haystack = [
      o.name,
      o.oneLiner ?? "",
      ...o.metrics.map((m) => m.label),
      ...o.evidence.map((e) => `${e.domain} ${e.quote}`),
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

export function sortOpportunities(opps: OpportunityVM[], key: SortKey): OpportunityVM[] {
  const copy = [...opps];
  copy.sort((a, b) => {
    switch (key) {
      case "name": return a.name.localeCompare(b.name);
      case "competition": return (a.competitorCount ?? 99) - (b.competitorCount ?? 99);
      case "evidence": return b.evidence.length - a.evidence.length;
      case "newest": return b.score - a.score;
      default: return b.score - a.score;
    }
  });
  return copy;
}

/* ------------------------------------------------------------------ export (F9) */

export interface ExportFile {
  id: "markdown" | "json" | "csv";
  label: string;
  filename: string;
  mime: string;
  text: string;
}

export interface ExportOptions {
  shortlistOnly?: boolean;
  shortlisted?: readonly string[];
}

function selected(run: RunVM, opts: ExportOptions): OpportunityVM[] {
  if (!opts.shortlistOnly) return run.opportunities;
  const saved = new Set(opts.shortlisted ?? []);
  return run.opportunities.filter((o) => saved.has(o.id));
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(run: RunVM, opts: ExportOptions = {}): string {
  const rows: string[] = [
    ["name", "score", "one_liner", "competitors", "gaps_filled", "gaps_total", "sources", "source_domains"].join(","),
  ];
  for (const o of selected(run, opts)) {
    const domains = Array.from(new Set(o.evidence.map((e) => e.domain).filter(Boolean))).join(" ");
    rows.push([
      csvCell(o.name),
      String(o.score),
      csvCell(o.oneLiner ?? ""),
      o.competitorCount === undefined ? "" : String(o.competitorCount),
      String(o.gaps.filter((g) => g.filled).length),
      String(o.gaps.length),
      String(o.evidence.length),
      csvCell(domains),
    ].join(","));
  }
  return rows.join("\n");
}

export function toMarkdown(run: RunVM, opts: ExportOptions = {}): string {
  const out: string[] = [];
  out.push(`# ${run.question}`);
  out.push("");
  out.push(`- Region: ${run.region}`);
  out.push(`- ${run.demo ? "Recorded demo" : "Live run"} · ${statusLabel(run.status)}`);
  out.push(`- Searches used: ${run.searchesUsed} of ${run.searchesCap}`);
  out.push(`- Claims with a verbatim source: ${run.coverage.sourced} of ${run.coverage.claims}`);
  if (run.coverage.discarded > 0) {
    out.push(`- Claims discarded for lack of a source: ${run.coverage.discarded}`);
  }
  if (run.notes.length > 0) {
    out.push("");
    for (const n of run.notes) out.push(`> ${n}`);
  }
  for (const o of selected(run, opts)) {
    out.push("");
    out.push(`## ${o.name} — ${o.score}/100${o.change && o.change !== "same" ? ` (${o.change})` : ""}`);
    if (o.oneLiner) {
      out.push("");
      out.push(o.oneLiner);
    }
    if (o.metrics.length > 0) {
      out.push("");
      for (const m of o.metrics) out.push(`- ${m.label}: ${m.value}/${m.max}`);
    }
    for (const g of o.gaps) {
      out.push(`- [${g.filled ? "x" : " "}] ${g.statement}${g.note ? ` — ${g.note}` : ""}`);
    }
    if (o.evidence.length > 0) {
      out.push("");
      out.push("### Sources (verbatim)");
      for (const e of o.evidence) {
        out.push("");
        out.push(`> ${e.quote}`);
        out.push("");
        out.push(`[${e.domain || e.url}](${e.url})`);
      }
    }
  }
  return out.join("\n");
}

export function toJson(run: RunVM, opts: ExportOptions = {}): string {
  return JSON.stringify(
    {
      question: run.question,
      region: run.region,
      status: run.status,
      demo: run.demo,
      searchesUsed: run.searchesUsed,
      searchesCap: run.searchesCap,
      coverage: run.coverage,
      notes: run.notes,
      opportunities: selected(run, opts).map((o) => ({
        name: o.name,
        one_liner: o.oneLiner,
        score: o.score,
        change: o.change,
        metrics: o.metrics.map((m) => ({ label: m.label, value: m.value, max: m.max })),
        gaps: o.gaps.map((g) => ({ statement: g.statement, filled: g.filled })),
        evidence: o.evidence.map((e) => ({ quote: e.quote, url: e.url, domain: e.domain })),
      })),
    },
    null,
    2,
  );
}

export function fileExports(run: RunVM, opts: ExportOptions = {}, prefix = "launchradar"): ExportFile[] {
  const slug = nameKey(run.question).replace(/ /g, "-").slice(0, 48) || "run";
  const scoped = opts.shortlistOnly ? "shortlist-" : "";
  return [
    { id: "markdown", label: "Markdown", filename: `${prefix}-${scoped}${slug}.md`, mime: "text/markdown", text: toMarkdown(run, opts) },
    { id: "json", label: "JSON", filename: `${prefix}-${scoped}${slug}.json`, mime: "application/json", text: toJson(run, opts) },
    { id: "csv", label: "CSV", filename: `${prefix}-${scoped}${slug}.csv`, mime: "text/csv", text: toCsv(run, opts) },
  ];
}





